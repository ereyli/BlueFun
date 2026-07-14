"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { formatEther, maxUint256, parseEther, zeroAddress } from "viem";
import { useAccount, useBalance, useChainId, useReadContract, useReadContracts, useSignMessage, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ArrowDownUp, Copy, ExternalLink, Loader2, LockKeyhole, RotateCcw, Settings, ShieldCheck, Sparkles } from "lucide-react";
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  UTCTimestamp
} from "lightweight-charts";
import {
  b20TokenAbi,
  bondingCurveAbi,
  contractsForChain,
  contractsForLaunch,
  feeSharingLockerAbi,
  graduationManagerAbi,
  indexerScopeForLaunch,
  permit2Abi,
  universalRouterAbi,
  uniswapV4QuoterAbi
} from "@/lib/contracts";
import {
  CURVE_FEE_RATE,
  TOTAL_SUPPLY,
  calculatePriceImpact,
  compactTokenAmount,
  compactUsd,
  formatPercent,
  formatUsdFromEthText,
  formatUsdPrice,
  parseDisplayAmount,
  shortAddress
} from "@/lib/market-math";
import { isOfficialBlue, isTrustedLaunch } from "@/lib/featured-launches";
import type { DeployedLaunch, DeployedTrade } from "@/lib/onchain-launches";
import { chainSlug } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";
import { siteUrl } from "@/lib/site-url";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";
import { blueFunV4PoolKey, buildV4EthToTokenSwap, buildV4TokenToEthSwap } from "@/lib/uniswap-v4-swap";
import { NetworkIcon } from "@/components/network-icon";
import { chatMessageToSign } from "@/lib/chat-auth";

const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = 281_474_976_710_655;

type DexPairSnapshot = {
  priceUsd: number;
  marketCap: number;
};

type MarketDataState = "idle" | "loading" | "ready" | "unavailable";
type RealtimeStatus = "connecting" | "subscribed" | "unavailable";

export function MarketClient({ id, launch, trades: initialTrades }: { id: string; launch?: DeployedLaunch; trades: DeployedTrade[] }) {
  const router = useRouter();
  const [trades, setTrades] = useState(initialTrades);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(200n);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [dexPair, setDexPair] = useState<DexPairSnapshot | null>(null);
  const [marketDataState, setMarketDataState] = useState<MarketDataState>("idle");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [chainSwitchError, setChainSwitchError] = useState("");
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const activeChainId = launch?.chainId === 4663 ? 4663 : 8453;
  const { addresses, chain, uniswapV4Addresses } = contractsForLaunch(activeChainId, id);
  const wrongNetwork = Boolean(isConnected && chainId && chainId !== activeChainId);

  async function switchWalletNetwork() {
    setChainSwitchError("");
    try {
      await switchChainAsync({ chainId: activeChainId });
    } catch (switchError) {
      const message = switchError instanceof Error ? switchError.message.toLowerCase() : "";
      setChainSwitchError(message.includes("rejected") || message.includes("denied")
        ? "Network switch was cancelled in your wallet."
        : `Could not switch to ${chain.name}. Open your wallet and select it manually.`);
    }
  }
  const { data: hash, error, writeContract, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const parsedAmount = parsePositiveEther(amount);
  const isGraduated = launch?.status === "Graduated";
  const v4PoolConfig = { fee: launch?.poolFee, tickSpacing: launch?.tickSpacing };
  const liquidityLockerAddress = launch?.liquidityLocker ?? addresses.liquidityLocker;
  const ethBalance = useBalance({
    address,
    query: { enabled: Boolean(address) }
  });
  const readEnabled = Boolean(addresses.bondingCurveMarket && parsedAmount > 0n && !isGraduated);
  const buyQuote = useReadContract({
    address: addresses.bondingCurveMarket,
    abi: bondingCurveAbi,
    functionName: "quoteBuy",
    args: [BigInt(id), parsedAmount],
    query: { enabled: readEnabled && mode === "buy" }
  });
  const sellQuote = useReadContract({
    address: addresses.bondingCurveMarket,
    abi: bondingCurveAbi,
    functionName: "quoteSell",
    args: [BigInt(id), parsedAmount],
    query: { enabled: readEnabled && mode === "sell" }
  });
  const accountFeeBalance = useReadContract({
    address: addresses.bondingCurveMarket,
    abi: bondingCurveAbi,
    functionName: "pendingFees",
    args: [address!],
    query: { enabled: Boolean(addresses.bondingCurveMarket && address) }
  });
  const feeSharingEnabled = Boolean(
    launch?.positionId && (launch.launchMode === "direct" || addresses.version === "current")
  );
  const lpFeeRevenue = useReadContract({
    address: liquidityLockerAddress,
    abi: feeSharingLockerAbi,
    functionName: "feeRevenue",
    args: [launch?.positionId ?? `0x${"0".repeat(64)}`],
    query: { enabled: feeSharingEnabled }
  });
  const lpNativePending = useReadContract({
    address: liquidityLockerAddress,
    abi: feeSharingLockerAbi,
    functionName: "pendingFees",
    args: [address ?? zeroAddress, zeroAddress],
    query: { enabled: Boolean(feeSharingEnabled && address) }
  });
  const lpTokenPending = useReadContract({
    address: liquidityLockerAddress,
    abi: feeSharingLockerAbi,
    functionName: "pendingFees",
    args: [address ?? zeroAddress, launch?.token ?? zeroAddress],
    query: { enabled: Boolean(feeSharingEnabled && address && launch?.token) }
  });
  const tokenAllowance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "allowance",
    args: [address ?? zeroAddress, addresses.bondingCurveMarket ?? zeroAddress],
    query: { enabled: Boolean(!isGraduated && mode === "sell" && launch?.token && address && addresses.bondingCurveMarket) }
  });
  const tokenBalance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    query: { enabled: Boolean(mode === "sell" && launch?.token && address) }
  });
  const graduatedTokenPermit2Allowance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "allowance",
    args: [address ?? zeroAddress, uniswapV4Addresses.permit2],
    query: { enabled: Boolean(isGraduated && mode === "sell" && launch?.token && address) }
  });
  const graduatedPermit2RouterAllowance = useReadContract({
    address: uniswapV4Addresses.permit2,
    abi: permit2Abi,
    functionName: "allowance",
    args: [address ?? zeroAddress, launch?.token ?? zeroAddress, uniswapV4Addresses.universalRouter],
    query: { enabled: Boolean(isGraduated && mode === "sell" && launch?.token && address) }
  });
  const graduatedQuote = useReadContract({
    address: uniswapV4Addresses.quoter,
    abi: uniswapV4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: blueFunV4PoolKey(launch?.token ?? zeroAddress, v4PoolConfig),
        zeroForOne: mode === "buy",
        exactAmount: parsedAmount,
        hookData: "0x"
      }
    ],
    query: {
      enabled: Boolean(isGraduated && launch?.token && parsedAmount > 0n),
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 8_000
    }
  });
  const quotedOut = mode === "buy" ? buyQuote.data?.[0] : sellQuote.data?.[0];
  const minOut = quotedOut ? applySlippage(quotedOut, slippageBps) : 0n;
  const quoteLoading = mode === "buy" ? buyQuote.isLoading : sellQuote.isLoading;
  const fallbackGraduatedQuote = useMemo(() => estimateGraduatedQuoteFromTrades(trades, mode, parsedAmount), [mode, parsedAmount, trades]);
  const quoteFromFallback = Boolean(!graduatedQuote.data?.[0] && graduatedQuote.error && fallbackGraduatedQuote);
  const graduatedQuotedOut = graduatedQuote.data?.[0] ?? (quoteFromFallback ? fallbackGraduatedQuote : undefined);
  const graduatedMinOut = graduatedQuotedOut ? applySlippage(graduatedQuotedOut, slippageBps) : 0n;
  const isWorking = isPending || receipt.isLoading;
  const sellBalance = tokenBalance.data ?? 0n;
  const spotPriceEth = launch ? parseDisplayAmount(launch.price) : 0;
  const priceImpact = quotedOut
    ? calculatePriceImpact({
      mode,
      amountIn: Number(formatEther(parsedAmount)),
      quotedOut: Number(formatEther(quotedOut)),
      spotPriceEth
    })
    : 0;
  const hasSellAllowance = mode !== "sell" || Boolean(tokenAllowance.data && tokenAllowance.data >= parsedAmount);
  const needsSellApproval = mode === "sell" && parsedAmount > 0n && !hasSellAllowance;
  const exceedsSellBalance = mode === "sell" && parsedAmount > sellBalance;
  const exceedsEthBalance = mode === "buy" && Boolean(ethBalance.data) && parsedAmount > (ethBalance.data?.value ?? 0n);
  const tradeDisabled = !addresses.bondingCurveMarket || !isConnected || wrongNetwork || isWorking || parsedAmount === 0n || exceedsEthBalance || exceedsSellBalance || (!needsSellApproval && minOut === 0n);
  const permit2Amount = graduatedPermit2RouterAllowance.data?.[0] ?? 0n;
  const permit2Expiration = graduatedPermit2RouterAllowance.data?.[1] ?? 0;
  const needsGraduatedTokenApproval = Boolean(isGraduated && mode === "sell" && parsedAmount > 0n && (graduatedTokenPermit2Allowance.data ?? 0n) < parsedAmount);
  const needsGraduatedPermit2Approval = Boolean(isGraduated && mode === "sell" && parsedAmount > 0n && !needsGraduatedTokenApproval && (permit2Amount < parsedAmount || BigInt(permit2Expiration) <= BigInt(Math.floor(Date.now() / 1000) + 900)));
  const graduatedBuyDisabled = !launch || !isConnected || wrongNetwork || isWorking || mode !== "buy" || parsedAmount === 0n || exceedsEthBalance || graduatedMinOut === 0n;
  const graduatedSellDisabled = !launch || !isConnected || wrongNetwork || isWorking || mode !== "sell" || parsedAmount === 0n || exceedsSellBalance || (!needsGraduatedTokenApproval && !needsGraduatedPermit2Approval && graduatedMinOut === 0n);
  const latestMarketCapEth = useMemo(() => {
    return trades
      .slice()
      .reverse()
      .find((trade) => trade.marketCapEth && parseDisplayAmount(trade.marketCapEth) > 0)
      ?.marketCapEth;
  }, [trades]);
  const launchMarketCapEth = launch && launch.marketCap.trim().toLowerCase() !== "live" && parseDisplayAmount(launch.marketCap) > 0
    ? launch.marketCap
    : undefined;
  const launchPriceEth = launch && launch.price.trim().toLowerCase() !== "live" && parseDisplayAmount(launch.price) > 0
    ? launch.price
    : undefined;
  const estimatedCurve = launch && !isGraduated ? estimateCurveSnapshot(launch.raised) : undefined;
  const displayMarketCap = latestMarketCapEth
    ? `${latestMarketCapEth} ETH`
    : launchMarketCapEth ?? estimatedCurve?.marketCap ?? "Live";
  const latestPriceEth = latestMarketCapEth ? parseDisplayAmount(latestMarketCapEth) / TOTAL_SUPPLY : 0;
  const displayPrice = latestPriceEth > 0
    ? `${decimalStringFromNumber(latestPriceEth.toPrecision(18))} ETH`
    : launchPriceEth ?? estimatedCurve?.price ?? "Live";
  const isEstimatedCurveData = Boolean(!isGraduated && !latestMarketCapEth && !launchMarketCapEth);
  const displayMarketCapText = latestMarketCapEth
    ? formatUsdFromEthText(displayMarketCap, ethUsd)
    : isGraduated
      ? dexPair?.marketCap ? compactUsd(dexPair.marketCap) : marketDataState === "loading" ? "Loading…" : "Unavailable"
      : formatUsdFromEthText(displayMarketCap, ethUsd);
  const displayPriceText = latestPriceEth > 0
    ? formatUsdFromEthText(displayPrice, ethUsd, true)
    : isGraduated
      ? dexPair?.priceUsd ? formatUsdPrice(dexPair.priceUsd) : marketDataState === "loading" ? "Loading…" : "Unavailable"
      : formatUsdFromEthText(displayPrice, ethUsd, true);
  const showCreatorEarnings = Boolean(address && (
    address.toLowerCase() === launch?.creator.toLowerCase()
    || (accountFeeBalance.data ?? 0n) > 0n
    || (lpNativePending.data ?? 0n) > 0n
    || (lpTokenPending.data ?? 0n) > 0n
  ));

  useEffect(() => {
    if (!receipt.isSuccess) return;
    const timeout = window.setTimeout(() => router.refresh(), 1_200);
    tokenAllowance.refetch();
    tokenBalance.refetch();
    graduatedTokenPermit2Allowance.refetch();
    graduatedPermit2RouterAllowance.refetch();
    graduatedQuote.refetch();
    lpFeeRevenue.refetch();
    lpNativePending.refetch();
    lpTokenPending.refetch();
    return () => window.clearTimeout(timeout);
  }, [graduatedPermit2RouterAllowance, graduatedQuote, graduatedTokenPermit2Allowance, lpFeeRevenue, lpNativePending, lpTokenPending, receipt.isSuccess, router, tokenAllowance, tokenBalance]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, realtimeStatus === "subscribed" ? 60_000 : 8_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [realtimeStatus, router]);

  useEffect(() => {
    setTrades((current) => mergeTrades(initialTrades, current));
  }, [initialTrades]);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const scope = indexerScopeForLaunch(activeChainId, id);
    if (!supabaseUrl || !supabaseAnonKey || !scope) {
      setRealtimeStatus("unavailable");
      return;
    }
    setRealtimeStatus("connecting");

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });
    const channel = supabase
      .channel(`launch-${id}-trades`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trades",
          filter: `launch_id=eq.${id}`
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null;
          const oldRow = payload.old as Record<string, unknown> | null;
          if (row?.scope !== scope && oldRow?.scope !== scope) return;
          const nextTrade = realtimeTrade(row);
          if (!nextTrade) return;
          setTrades((current) => {
            const withoutPrevious = current.filter((trade) => !sameTrade(trade, nextTrade));
            return [...withoutPrevious, nextTrade].slice(-250);
          });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("subscribed");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeStatus("unavailable");
        else setRealtimeStatus("connecting");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeChainId, id]);

  useEffect(() => {
    let active = true;
    async function loadEthPrice() {
      try {
        const response = await fetch("/api/eth-price", { cache: "no-store" });
        const payload = await response.json() as { ethUsd?: number | null };
        if (active && payload.ethUsd) setEthUsd(payload.ethUsd);
      } catch {
        if (active) setEthUsd(null);
      }
    }
    loadEthPrice();
    const interval = window.setInterval(loadEthPrice, 300_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!isGraduated || !launch?.token) {
      setDexPair(null);
      setMarketDataState("idle");
      return;
    }

    let active = true;
    async function loadDexPair() {
      if (active) setMarketDataState((current) => current === "ready" ? current : "loading");
      try {
        const response = await fetch(`/api/dexscreener/token/${launch?.token}?chain=${chainSlug(activeChainId)}`, { cache: "no-store" });
        const payload = await response.json() as { pair?: Partial<DexPairSnapshot> | null };
        const priceUsd = Number(payload.pair?.priceUsd);
        const marketCap = Number(payload.pair?.marketCap);
        const nextPair = Number.isFinite(priceUsd) && priceUsd > 0 && Number.isFinite(marketCap) && marketCap > 0 ? { priceUsd, marketCap } : null;
        if (active) {
          setDexPair(nextPair);
          setMarketDataState(nextPair ? "ready" : "unavailable");
        }
      } catch {
        if (active) {
          setDexPair(null);
          setMarketDataState("unavailable");
        }
      }
    }

    loadDexPair();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadDexPair();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeChainId, isGraduated, launch?.token]);

  function buy() {
    if (!addresses.bondingCurveMarket || parsedAmount === 0n || minOut === 0n) return;
    writeContract({
      chainId: activeChainId,
      address: addresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "buy",
      args: [BigInt(id), minOut, BigInt(Math.floor(Date.now() / 1000) + 900)],
      value: parsedAmount
    });
  }

  function buyGraduated() {
    if (!launch || parsedAmount === 0n || graduatedMinOut === 0n) return;
    const swap = buildV4EthToTokenSwap({
      amountIn: parsedAmount,
      amountOutMinimum: graduatedMinOut,
      token: launch.token,
      poolFee: launch.poolFee,
      tickSpacing: launch.tickSpacing
    });

    writeContract({
      chainId: activeChainId,
      address: uniswapV4Addresses.universalRouter,
      abi: universalRouterAbi,
      functionName: "execute",
      args: [swap.commands, swap.inputs, BigInt(Math.floor(Date.now() / 1000) + 900)],
      value: parsedAmount
    });
  }

  function approveGraduatedTokenPermit2() {
    if (!launch || parsedAmount === 0n) return;
    writeContract({
      chainId: activeChainId,
      address: launch.token,
      abi: b20TokenAbi,
      functionName: "approve",
      args: [uniswapV4Addresses.permit2, maxUint256]
    });
  }

  function approveGraduatedPermit2Router() {
    if (!launch || parsedAmount === 0n) return;
    writeContract({
      chainId: activeChainId,
      address: uniswapV4Addresses.permit2,
      abi: permit2Abi,
      functionName: "approve",
      args: [launch.token, uniswapV4Addresses.universalRouter, MAX_UINT160, MAX_UINT48]
    });
  }

  function sellGraduated() {
    if (!launch || parsedAmount === 0n || graduatedMinOut === 0n) return;
    const swap = buildV4TokenToEthSwap({
      amountIn: parsedAmount,
      amountOutMinimum: graduatedMinOut,
      token: launch.token,
      poolFee: launch.poolFee,
      tickSpacing: launch.tickSpacing
    });

    writeContract({
      chainId: activeChainId,
      address: uniswapV4Addresses.universalRouter,
      abi: universalRouterAbi,
      functionName: "execute",
      args: [swap.commands, swap.inputs, BigInt(Math.floor(Date.now() / 1000) + 900)]
    });
  }

  function approveSell() {
    if (!addresses.bondingCurveMarket || !launch || parsedAmount === 0n) return;
    writeContract({
      chainId: activeChainId,
      address: launch.token,
      abi: b20TokenAbi,
      functionName: "approve",
      args: [addresses.bondingCurveMarket, maxUint256]
    });
  }

  function sell() {
    if (!addresses.bondingCurveMarket || parsedAmount === 0n || minOut === 0n) return;
    writeContract({
      chainId: activeChainId,
      address: addresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "sell",
      args: [BigInt(id), parsedAmount, minOut, BigInt(Math.floor(Date.now() / 1000) + 900)]
    });
  }

  function graduate() {
    if (!addresses.graduationManager || !launch || launch.status !== "Ready") return;
    writeContract({
      chainId: activeChainId,
      address: addresses.graduationManager,
      abi: graduationManagerAbi,
      functionName: "graduate",
      args: [BigInt(id)]
    });
  }

  function claimFees() {
    if (!addresses.bondingCurveMarket) return;
    writeContract({
      chainId: activeChainId,
      address: addresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "claimFees"
    });
  }

  function collectLpFees() {
    if (!launch?.positionId || (launch.launchMode !== "direct" && addresses.version !== "current")) return;
    writeContract({
      chainId: activeChainId,
      address: liquidityLockerAddress,
      abi: feeSharingLockerAbi,
      functionName: "collectFees",
      args: [launch.positionId]
    });
  }

  function claimLpFees(currency: `0x${string}`) {
    if (launch?.launchMode !== "direct" && addresses.version !== "current") return;
    writeContract({
      chainId: activeChainId,
      address: liquidityLockerAddress,
      abi: feeSharingLockerAbi,
      functionName: "claimFees",
      args: [currency]
    });
  }

  function setSellPercent(percent: bigint) {
    if (sellBalance === 0n) return;
    setAmount(formatTokenInput((sellBalance * percent) / 100n));
  }

  if (!launch) {
    return <div className="empty">Loading market...</div>;
  }

  const trusted = isTrustedLaunch(launch);
  const officialBlue = isOfficialBlue(launch);

  return (
    <div className="trade-layout">
      <section className="market-summary-column">
        <div className="market-header-card">
          <div className="market-header-main">
            <TokenAvatar launch={launch} className="profile-art" />
            <div className="market-title-block">
              <div className="market-title-row">
                <h1>{launch.name}</h1>
                {officialBlue
                  ? <span className="trusted-badge official-blue-badge"><ShieldCheck size={13} />Official BLUE</span>
                  : trusted ? <span className="trusted-badge"><ShieldCheck size={13} />Trusted</span> : null}
                <span className={launch.status === "Live" ? "token-status live" : "token-status"}>{launch.status === "Live" ? "Bonding" : launch.status === "Ready" ? "Bonded" : launch.status}</span>
              </div>
              <div className="market-meta">
                <span>${launch.symbol}</span>
                <span>{launch.age} ago</span>
                <span>{launch.creator.slice(0, 6)}...{launch.creator.slice(-4)}</span>
              </div>
              <div className={trusted ? "market-route-pill trusted" : "market-route-pill"}>
                <ShieldCheck size={12} />{trusted ? "Verified market" : "Official curve"}
              </div>
            </div>
            <div className="market-actions">
              <a className="market-icon-action x-share-button" aria-label="Share on X" title="Share on X" href={xShareUrl(launch)} target="_blank" rel="noreferrer">
                <span className="x-share-icon">X</span>
              </a>
              <a className="market-icon-action" aria-label="Open token explorer" title={chain.name === "Base" ? "BaseScan" : "Explorer"} href={`${chain.blockExplorers.default.url}/token/${launch.token}`} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
              </a>
              <button className="market-icon-action" aria-label="Copy token address" title="Copy token address" onClick={() => navigator.clipboard.writeText(launch.token)}>
                <Copy size={16} />
              </button>
            </div>
          </div>
          {officialBlue ? (
            <section className="official-blue-identity" aria-label="Official BLUE network identity">
              <div className="official-blue-identity-title">
                <span><Sparkles size={14} />Official BLUE</span>
                <small>Canonical asset</small>
              </div>
              <div className="official-blue-identity-grid">
                <div><span>Home network</span><strong><NetworkIcon chainId={8453} size={16} />Base</strong></div>
                <div><span>Also available on</span><strong><NetworkIcon chainId={4663} size={16} />Robinhood Chain <em>Coming soon</em></strong></div>
                <div><span>Supply model</span><strong><LockKeyhole size={15} />Unified global supply</strong></div>
              </div>
            </section>
          ) : null}
          <div className="market-header-stats">
            <div><span>{isEstimatedCurveData ? "Estimated MC" : "Market cap"}</span><strong>{displayMarketCapText}</strong></div>
            <div><span>{isEstimatedCurveData ? "Estimated price" : "Price"}</span><strong>{displayPriceText}</strong></div>
            <div><span>Raised</span><strong>{launch.raised}</strong></div>
            <div><span>Bonded</span><strong>{launch.progress}%</strong></div>
          </div>
          {isGraduated && !latestMarketCapEth && marketDataState !== "ready" ? (
            <div className={`market-data-note ${marketDataState}`}>
              <span className="wallet-status-dot" />
              {marketDataState === "loading" ? "Fetching live Uniswap market data…" : "Live DEX pricing is temporarily unavailable. Trading remains available onchain."}
            </div>
          ) : null}
          <div className="progress"><span style={{ width: `${launch.progress}%` }} /></div>
        </div>

      </section>

      <section className="market-content-column">
        <div className="chart-panel">
          <div className="curve-state compact">
            <TradeChart trades={trades} status={launch.status} symbol={launch.symbol} ethUsd={ethUsd} />
            <MarketStats
              launch={launch}
              trades={trades}
            />
            <HolderDistribution launch={launch} trades={trades} />
            <ProjectInfo launch={launch} />
            <RecentTrades trades={trades} symbol={launch.symbol} chainId={launch.chainId} />
          </div>
        </div>
      </section>

      <aside className="trade-box">
        {launch.status === "Graduated" ? (
          <GraduatedTradeCard
            amount={amount}
            error={error?.message}
            exceedsEthBalance={exceedsEthBalance}
            exceedsSellBalance={exceedsSellBalance}
            isConnected={isConnected}
            isPending={isPending}
            isSwitchingNetwork={isSwitchingChain}
            isWorking={isWorking}
            chainSwitchError={chainSwitchError}
            launch={launch}
            minOut={graduatedMinOut}
            mode={mode}
            needsPermit2Approval={needsGraduatedPermit2Approval}
            needsTokenApproval={needsGraduatedTokenApproval}
            onApprovePermit2={approveGraduatedPermit2Router}
            onApproveToken={approveGraduatedTokenPermit2}
            onBuy={buyGraduated}
            onSwitchNetwork={switchWalletNetwork}
            onSell={sellGraduated}
            quote={graduatedQuotedOut}
            quoteFromFallback={quoteFromFallback}
            quoteLoading={(graduatedQuote.isLoading || graduatedQuote.isFetching) && !graduatedQuotedOut}
            receiptSuccess={Boolean(receipt.isSuccess)}
            sellBalance={sellBalance}
            setAmount={setAmount}
            setMode={setMode}
            setSellPercent={setSellPercent}
            setSettingsOpen={setSettingsOpen}
            settingsOpen={settingsOpen}
            slippageBps={slippageBps}
            tradeDisabled={mode === "buy" ? graduatedBuyDisabled : graduatedSellDisabled}
            updateSlippage={setSlippageBps}
            wrongNetwork={wrongNetwork}
          />
        ) : (
          <section className="trade-card">
            <div className="trade-card-toolbar">
              <div><strong>Trade</strong><span>BlueFun curve</span></div>
            </div>
            <div className="form">
              <div className="trade-tabs trade-tabs-top" role="tablist" aria-label="Trade direction">
                <button aria-selected={mode === "buy"} className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")} role="tab" type="button">Buy ${launch.symbol}</button>
                <button aria-selected={mode === "sell"} className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")} role="tab" type="button">Sell</button>
              </div>
              {!isConnected ? (
                <div className="wallet-trade-gate"><span className="wallet-status-dot" />Connect wallet to trade</div>
              ) : null}
              {wrongNetwork ? (
                <TradeStatus tone="danger">
                  <span>Wallet is on chain {chainId}. Switch to {chain.name} to trade.</span>
                  <button className="inline-network-switch" disabled={isSwitchingChain} onClick={switchWalletNetwork} type="button">
                    {isSwitchingChain ? "Switching…" : `Switch to ${chain.name}`}
                  </button>
                </TradeStatus>
              ) : null}
              {chainSwitchError ? <TradeStatus tone="danger">{chainSwitchError}</TradeStatus> : null}
              <div className="trade-amount-block">
                <div className="trade-amount-head">
                  <span>You pay</span>
                  {mode === "sell" ? (
                    <button className="balance-button" onClick={() => setSellPercent(100n)} type="button">
                      {formatTokenBalance(sellBalance)} {launch.symbol}
                    </button>
                  ) : null}
                </div>
                <div className="trade-input-shell">
                  <input aria-label={mode === "buy" ? "ETH amount" : `${launch.symbol} amount`} className="amount-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                  <strong>{mode === "buy" ? "ETH" : launch.symbol}</strong>
                </div>
              </div>
              <div className="trade-quick-settings">
                <div className={mode === "buy" ? "quick-grid" : "quick-grid sell-grid"}>
                  {mode === "buy" ? (
                    <><button type="button" onClick={() => setAmount("0.01")}>0.01</button><button type="button" onClick={() => setAmount("0.05")}>0.05</button><button type="button" onClick={() => setAmount("0.1")}>0.1</button></>
                  ) : (
                    <><button type="button" onClick={() => setSellPercent(25n)}>25%</button><button type="button" onClick={() => setSellPercent(50n)}>50%</button><button type="button" onClick={() => setSellPercent(75n)}>75%</button><button type="button" onClick={() => setSellPercent(100n)}>Max</button></>
                  )}
                </div>
                <button className={settingsOpen ? "settings-button active" : "settings-button"} onClick={() => setSettingsOpen((open) => !open)} type="button" aria-label="Trade settings"><Settings size={16} /></button>
              </div>
              <div className="quote-box">
                <div className="quote-head">
                  <span>{quoteLoading ? "Updating quote" : "You receive"}</span>
                </div>
                <strong>{quotedOut ? formatQuote(quotedOut, mode === "buy" ? launch.symbol : "ETH") : "-"}</strong>
                <div className="quote-breakdown">
                  <span>
                    <small>Minimum</small>
                    <b>{minOut ? formatQuote(minOut, mode === "buy" ? launch.symbol : "ETH") : "-"}</b>
                  </span>
                  <span>
                    <small>Impact</small>
                    <b>{formatPercent(priceImpact)}</b>
                  </span>
                </div>
              </div>
              <div className="trade-meta-line"><span><NetworkIcon chainId={activeChainId} size={14} />{chain.name}</span><i />BlueFun curve<i />1% fee</div>
              {priceImpact > 5 ? <TradeStatus tone="danger">High price impact: reduce the order size or increase slippage carefully.</TradeStatus> : null}
              {settingsOpen ? (
                <div className="trade-settings-panel">
                  <div className="settings-panel-head">
                    <strong>Trade settings</strong>
                    <span>Slippage</span>
                  </div>
                  <div className="slippage-row">
                    {[50n, 100n, 200n, 300n].map((value) => (
                      <button
                        className={slippageBps === value ? "selected" : ""}
                        key={value.toString()}
                        onClick={() => setSlippageBps(value)}
                        type="button"
                      >
                        {Number(value) / 100}%
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {mode === "buy" ? (
                <>
                  <button className="button primary trade-submit buy" disabled={tradeDisabled} onClick={buy}>
                    {isWorking ? <Loader2 className="spin" size={16} /> : <ArrowDownUp size={16} />}
                    {isPending ? "Confirm in wallet" : receipt.isLoading ? "Buying" : exceedsEthBalance ? "Insufficient ETH" : `Buy $${launch.symbol}`}
                  </button>
                </>
              ) : (
                <>
                  <button className="button primary trade-submit sell" disabled={tradeDisabled} onClick={needsSellApproval ? approveSell : sell}>
                    {isWorking ? <Loader2 className="spin" size={16} /> : <ArrowDownUp size={16} />}
                    {isPending
                      ? "Confirm in wallet"
                      : receipt.isLoading
                        ? needsSellApproval ? "Approving" : "Selling"
                        : exceedsSellBalance ? "Insufficient balance" : needsSellApproval ? `Approve $${launch.symbol}` : `Sell $${launch.symbol}`}
                  </button>
                  {needsSellApproval ? <span className="trade-helper">One-time token approval required.</span> : null}
                </>
              )}
              <div className="trade-status-stack">
                {receipt.isSuccess ? <TradeStatus tone="success">{mode === "buy" ? "Purchase completed." : "Sale completed."}</TradeStatus> : null}
                {!receipt.isSuccess && error ? <TradeStatus tone="danger">{friendlyTradeError(error.message)}</TradeStatus> : null}
              </div>
            </div>
          </section>
        )}

        <TokenChat launch={launch} launchId={id} wallet={address} isConnected={isConnected} />

        {launch.status === "Ready" ? (
          <section className="side-compact-card">
            <div className="side-card-head">
              <span>Graduation ready</span>
              <strong>Uniswap v4</strong>
            </div>
            <button className="button primary wide" disabled={!addresses.graduationManager || !isConnected || isWorking} onClick={graduate}>
              {isWorking ? <Loader2 className="spin" size={16} /> : <LockKeyhole size={16} />}
              {isPending ? "Confirm in wallet" : receipt.isLoading ? "Graduating" : "Graduate to Uniswap v4"}
            </button>
          </section>
        ) : null}

        {feeSharingEnabled ? <section className="side-compact-card lp-revenue-card">
          <div className="side-card-head">
            <span>Locked LP revenue</span>
            <strong>70% / 30%</strong>
          </div>
          <div className="lp-revenue-grid">
            <div>
              <span>Total ETH fees</span>
              <strong>{formatQuote(lpFeeRevenue.data?.[0] ?? 0n, "ETH")}</strong>
            </div>
            <div>
              <span>Total token fees</span>
              <strong>{formatQuote(lpFeeRevenue.data?.[1] ?? 0n, launch.symbol)}</strong>
            </div>
          </div>
          <p className="trade-helper">LP principal stays permanently locked. Collected fees split 70% to BlueFun and 30% to the creator.</p>
          <button className="button secondary wide" disabled={!isConnected || isWorking} onClick={collectLpFees} type="button">
            {isWorking ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
            Sync LP fees
          </button>
        </section> : null}

        {showCreatorEarnings ? <section className="side-compact-card">
          <div className="side-card-head">
            <span>Your earnings</span>
            <strong>{accountFeeBalance.data ? formatQuote(accountFeeBalance.data, "ETH") : "0 ETH"}</strong>
          </div>
          <button
            className="button primary wide"
            disabled={!isConnected || isWorking || !accountFeeBalance.data}
            onClick={claimFees}
            type="button"
          >
            {isWorking ? <Loader2 className="spin" size={16} /> : null}
            {isPending ? "Confirm in wallet" : receipt.isLoading ? "Claiming" : "Claim curve fees"}
          </button>
          {feeSharingEnabled ? <div className="lp-claim-actions">
            <button
              className="button secondary wide"
              disabled={!isConnected || isWorking || !lpNativePending.data}
              onClick={() => claimLpFees(zeroAddress)}
              type="button"
            >
              Claim {formatQuote(lpNativePending.data ?? 0n, "ETH")}
            </button>
            <button
              className="button secondary wide"
              disabled={!isConnected || isWorking || !lpTokenPending.data}
              onClick={() => claimLpFees(launch.token)}
              type="button"
            >
              Claim {formatQuote(lpTokenPending.data ?? 0n, launch.symbol)}
            </button>
          </div> : null}
        </section> : null}
      </aside>
    </div>
  );
}

function realtimeTrade(row: Record<string, unknown> | null): DeployedTrade | undefined {
  if (!row?.tx_hash || !row.eth_amount || !row.token_amount) return undefined;
  try {
    return {
      side: row.side === "sell" ? "sell" : "buy",
      source: row.source === "uniswap_v4" ? "uniswap_v4" : "curve",
      trader: typeof row.trader === "string" && /^0x[a-fA-F0-9]{40}$/.test(row.trader)
        ? row.trader as `0x${string}`
        : undefined,
      ethAmount: `${formatRealtimeEth(row.eth_amount)} ETH`,
      tokenAmount: formatRealtimeEth(row.token_amount),
      marketCapEth: row.market_cap_eth ? formatEther(BigInt(String(row.market_cap_eth))) : undefined,
      txHash: String(row.tx_hash),
      blockNumber: String(row.block_number || ""),
      createdAt: String(row.created_at || new Date().toISOString())
    };
  } catch {
    return undefined;
  }
}

function formatRealtimeEth(value: unknown) {
  const [whole, fraction = ""] = formatEther(BigInt(String(value))).split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function sameTrade(left: DeployedTrade, right: DeployedTrade) {
  return left.txHash === right.txHash && left.side === right.side;
}

function mergeTrades(serverTrades: DeployedTrade[], localTrades: DeployedTrade[]) {
  const merged = new Map<string, DeployedTrade>();
  for (const trade of [...serverTrades, ...localTrades]) {
    merged.set(`${trade.txHash}:${trade.side}`, trade);
  }
  return Array.from(merged.values())
    .sort((left, right) => Number(BigInt(left.blockNumber || "0") - BigInt(right.blockNumber || "0")))
    .slice(-250);
}

type ChatMessage = {
  id: string;
  wallet: string;
  text: string;
  createdAt: number;
};

function TokenChat({
  isConnected,
  launch,
  launchId,
  wallet
}: {
  isConnected: boolean;
  launch: DeployedLaunch;
  launchId: string;
  wallet?: `0x${string}`;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    if (!open) return;
    let active = true;
    async function loadMessages() {
      try {
        const response = await fetch(`/api/chat/messages?token=${launch.token}&chain=${chainSlug(launch.chainId)}`, { cache: "no-store" });
        const payload = await response.json() as { messages?: ChatMessage[] };
        if (active) setMessages(payload.messages ?? []);
      } catch {
        if (active) setStatus("Chat is reconnecting.");
      }
    }
    loadMessages();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadMessages();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [launch.chainId, launch.token, open]);

  async function sendMessage() {
    if (!wallet || !isConnected || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setStatus("");
    try {
      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: chatMessageToSign({ chainId: launch.chainId, launchId, token: launch.token, text, timestamp }) });
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: launch.chainId, launchId, token: launch.token, wallet, text, timestamp, signature })
      });
      const payload = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !payload.message) {
        setStatus(payload.error || "Message could not be sent.");
        return;
      }
      setDraft("");
      setMessages((current) => [...current, payload.message!].slice(-20));
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message.toLowerCase() : "";
      setStatus(message.includes("rejected") || message.includes("denied") ? "Signature cancelled." : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <details className="token-chat-card" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="token-chat-summary">
        <span>Community</span><strong>{messages.length}</strong>
      </summary>
      <div className="token-chat-body">
        <div className="token-chat-feed">
          {messages.length === 0 ? (
            <div className="token-chat-empty">No messages yet.</div>
          ) : (
            messages.map((message) => (
              <div className="token-chat-message" key={message.id}>
                <div>
                  <strong>{shortAddress(message.wallet)}</strong>
                  <span>{formatChatAge(message.createdAt)}</span>
                </div>
                <p>{message.text}</p>
              </div>
            ))
          )}
        </div>
        <div className="token-chat-compose">
          <input
            disabled={!isConnected}
            maxLength={240}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") sendMessage();
            }}
            placeholder={isConnected ? `Message $${launch.symbol}` : "Connect to chat"}
            value={draft}
          />
          <button className="button primary" disabled={!isConnected || sending || !draft.trim()} onClick={sendMessage} type="button">
            {sending ? <Loader2 className="spin" size={14} /> : null}Send
          </button>
        </div>
        {status ? <p className="token-chat-status">{status}</p> : null}
      </div>
    </details>
  );
}

function TradeStatus({ children, tone }: { children: React.ReactNode; tone: "info" | "success" | "danger" }) {
  return <div className={`trade-status ${tone}`}>{children}</div>;
}

function xShareUrl(launch: DeployedLaunch) {
  const text = `Trade ${launch.name} ($${launch.symbol}) on BlueFun`;
  const url = siteUrl(tokenPath(launch));
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

function GraduatedTradeCard({
  amount,
  chainSwitchError,
  error,
  exceedsEthBalance,
  exceedsSellBalance,
  isConnected,
  isPending,
  isSwitchingNetwork,
  isWorking,
  launch,
  minOut,
  mode,
  needsPermit2Approval,
  needsTokenApproval,
  onApprovePermit2,
  onApproveToken,
  onBuy,
  onSwitchNetwork,
  onSell,
  quote,
  quoteFromFallback,
  quoteLoading,
  receiptSuccess,
  sellBalance,
  setAmount,
  setMode,
  setSellPercent,
  setSettingsOpen,
  settingsOpen,
  slippageBps,
  tradeDisabled,
  updateSlippage,
  wrongNetwork
}: {
  amount: string;
  chainSwitchError: string;
  error?: string;
  exceedsEthBalance: boolean;
  exceedsSellBalance: boolean;
  isConnected: boolean;
  isPending: boolean;
  isSwitchingNetwork: boolean;
  isWorking: boolean;
  launch: DeployedLaunch;
  minOut: bigint;
  mode: "buy" | "sell";
  needsPermit2Approval: boolean;
  needsTokenApproval: boolean;
  onApprovePermit2: () => void;
  onApproveToken: () => void;
  onBuy: () => void;
  onSwitchNetwork: () => void;
  onSell: () => void;
  quote?: bigint;
  quoteFromFallback: boolean;
  quoteLoading: boolean;
  receiptSuccess: boolean;
  sellBalance: bigint;
  setAmount: (amount: string) => void;
  setMode: (mode: "buy" | "sell") => void;
  setSellPercent: (percent: bigint) => void;
  setSettingsOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  settingsOpen: boolean;
  slippageBps: bigint;
  tradeDisabled: boolean;
  updateSlippage: (value: bigint) => void;
  wrongNetwork: boolean;
}) {
  const { chain, uniswapChainName } = contractsForChain(launch.chainId);
  return (
    <section className="graduated-trade-card">
      <div className="trade-card-toolbar graduated-trade-toolbar">
        <div className="graduated-badge">
          <Sparkles size={16} />
          Graduated
        </div>
      </div>
      <div className="form graduated-swap-form">
        <div className="trade-tabs trade-tabs-top" role="tablist" aria-label="Trade direction">
          <button aria-selected={mode === "buy"} className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")} role="tab" type="button">Buy ${launch.symbol}</button>
          <button aria-selected={mode === "sell"} className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")} role="tab" type="button">Sell</button>
        </div>
        {!isConnected ? (
          <div className="notice compact">
            <strong>Connect wallet</strong>
            <span>Wallet connection is required before trading.</span>
          </div>
        ) : null}
        {wrongNetwork ? (
          <TradeStatus tone="danger">
            <span>Switch your wallet to {chain.name} before trading.</span>
            <button className="inline-network-switch" disabled={isSwitchingNetwork} onClick={onSwitchNetwork} type="button">
              {isSwitchingNetwork ? "Switching…" : `Switch to ${chain.name}`}
            </button>
          </TradeStatus>
        ) : null}
        {chainSwitchError ? <TradeStatus tone="danger">{chainSwitchError}</TradeStatus> : null}
        <div className="trade-amount-block">
          <div className="trade-amount-head">
            <span>{mode === "buy" ? "You pay" : "You sell"}</span>
            {mode === "sell" ? (
              <button className="balance-button" onClick={() => setSellPercent(100n)} type="button">
                {formatTokenBalance(sellBalance)} {launch.symbol}
              </button>
            ) : null}
          </div>
          <div className="trade-input-shell">
            <input aria-label={mode === "buy" ? "ETH amount" : `${launch.symbol} amount`} className="amount-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <strong>{mode === "buy" ? "ETH" : launch.symbol}</strong>
          </div>
        </div>
        <div className="trade-quick-settings">
          <div className={mode === "buy" ? "quick-grid" : "quick-grid sell-grid"}>
            {mode === "buy" ? (
              <>
                <button type="button" onClick={() => setAmount("0.01")}>0.01</button>
                <button type="button" onClick={() => setAmount("0.05")}>0.05</button>
                <button type="button" onClick={() => setAmount("0.1")}>0.1</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSellPercent(25n)}>25%</button>
                <button type="button" onClick={() => setSellPercent(50n)}>50%</button>
                <button type="button" onClick={() => setSellPercent(75n)}>75%</button>
                <button type="button" onClick={() => setSellPercent(100n)}>Max</button>
              </>
            )}
          </div>
          <button className={settingsOpen ? "settings-button active" : "settings-button"} onClick={() => setSettingsOpen((open) => !open)} type="button" aria-label="Trade settings"><Settings size={16} /></button>
        </div>
        <div className="quote-box">
          <div className="quote-head">
            <span>{quoteLoading ? "Quoting Uniswap v4..." : mode === "buy" ? "Estimated tokens" : "Estimated ETH"}</span>
          </div>
          <strong>{quote ? formatQuote(quote, mode === "buy" ? launch.symbol : "ETH") : "-"}</strong>
          <div className="quote-breakdown">
            <span>
              <small>Min received</small>
              <b>{minOut ? formatQuote(minOut, mode === "buy" ? launch.symbol : "ETH") : "-"}</b>
            </span>
            <span>
              <small>Route</small>
              <b>{quoteFromFallback ? "Indexed price" : "Uniswap v4"}</b>
            </span>
          </div>
        </div>
        {settingsOpen ? (
          <div className="trade-settings-panel">
            <div className="settings-panel-head">
              <strong>Trade settings</strong>
              <span>Slippage</span>
            </div>
            <div className="slippage-row">
              {[50n, 100n, 200n, 300n].map((value) => (
                <button
                  className={slippageBps === value ? "selected" : ""}
                  key={value.toString()}
                  onClick={() => updateSlippage(value)}
                  type="button"
                >
                  {Number(value) / 100}%
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="trade-meta-line"><span><NetworkIcon chainId={launch.chainId} size={14} />{chain.name}</span><i />Uniswap v4<i />Locked liquidity</div>
        {mode === "buy" ? (
          <>
            <button className="button primary wide trade-submit buy" disabled={tradeDisabled} onClick={onBuy} type="button">
              {isWorking ? <Loader2 className="spin" size={16} /> : <ArrowDownUp size={16} />}
              {isPending ? "Confirm in wallet" : isWorking ? "Buying" : exceedsEthBalance ? "Insufficient ETH" : `Buy $${launch.symbol}`}
            </button>
          </>
        ) : (
          <>
            <button
              className="button primary wide trade-submit sell"
              disabled={tradeDisabled}
              onClick={needsTokenApproval ? onApproveToken : needsPermit2Approval ? onApprovePermit2 : onSell}
              type="button"
            >
              {isWorking ? <Loader2 className="spin" size={16} /> : <ArrowDownUp size={16} />}
              {isPending
                ? "Confirm in wallet"
                : isWorking
                  ? needsTokenApproval || needsPermit2Approval ? "Approving" : "Selling"
                  : exceedsSellBalance
                    ? "Insufficient balance"
                    : needsTokenApproval
                      ? "Approve Permit2"
                      : needsPermit2Approval
                        ? "Approve router"
                        : `Sell $${launch.symbol}`}
            </button>
            <span className="trade-helper">
              {needsTokenApproval
                ? "One-time token approval lets Permit2 access this token."
                : needsPermit2Approval
                  ? "One-time Permit2 approval lets the router execute sells."
                  : "Selling routes through the locked Uniswap v4 pool."}
            </span>
          </>
        )}
        <div className="trade-status-stack">
          {receiptSuccess ? <TradeStatus tone="success">{mode === "buy" ? "Purchase completed." : "Sale completed."}</TradeStatus> : null}
          {!receiptSuccess && error ? <TradeStatus tone="danger">{friendlyTradeError(error)}</TradeStatus> : null}
        </div>
      </div>
      <a className="button wide trade-external-link" href={uniswapSwapUrl(launch.token, uniswapChainName)} target="_blank" rel="noreferrer">
        <ExternalLink size={16} />
        Trade on Uniswap
      </a>
      <a className="button wide" href={`${chain.blockExplorers.default.url}/token/${launch.token}`} target="_blank" rel="noreferrer">
        View token
      </a>
    </section>
  );
}

function ProjectInfo({ launch }: { launch: DeployedLaunch }) {
  const links = [
    { label: "Website", href: launch.website },
    { label: "X", href: launch.twitter },
    { label: "Telegram", href: launch.telegram },
    { label: "Discord", href: launch.discord }
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <section className="project-info-panel market-overview-panel">
      <div className="project-info-head">
        <h2>Market overview</h2>
        <span><NetworkIcon chainId={launch.chainId} size={15} />{launch.chainId === 4663 ? "Robinhood" : "Base"}</span>
      </div>
      {launch.description ? <p>{launch.description}</p> : null}
      <dl className="market-overview-grid">
        <div><dt>Standard</dt><dd>{launch.chainId === 4663 ? "ERC-20" : "B20"}</dd></div>
        <div><dt>Trading fee</dt><dd>1% total</dd></div>
        <div><dt>Liquidity</dt><dd>{launch.status === "Graduated" ? "Uniswap v4 · locked" : "Bonding curve"}</dd></div>
      </dl>
      <details className="market-details-disclosure">
        <summary><span>Contract details</span><small>Token, creator and supply</small></summary>
        <dl className="market-facts-grid compact">
          <div><dt>Token</dt><dd>{shortAddress(launch.token)}</dd></div>
          <div><dt>Creator</dt><dd>{shortAddress(launch.creator)}</dd></div>
          <div><dt>Supply</dt><dd>1,000,000,000</dd></div>
        </dl>
        {links.length ? (
          <div className="project-link-row">
            {links.map((link) => (
              <a href={link.href} key={link.label} target="_blank" rel="noreferrer">
                {link.label}<ExternalLink size={13} />
              </a>
            ))}
          </div>
        ) : null}
      </details>
      <p className="market-risk-note">Community tokens are volatile. Verify the contract and trade responsibly. <a href="/risk">Read risk disclosure</a></p>
    </section>
  );
}

function uniswapSwapUrl(token: `0x${string}`, chainName: string, direction: "buy" | "sell" = "buy") {
  const inputCurrency = direction === "buy" ? "ETH" : token;
  const outputCurrency = direction === "buy" ? token : "ETH";
  return `https://app.uniswap.org/swap?chain=${chainName}&inputCurrency=${inputCurrency}&outputCurrency=${outputCurrency}`;
}

function RecentTrades({ trades, symbol, chainId: launchChainId }: { trades: DeployedTrade[]; symbol: string; chainId: number }) {
  const { chain } = contractsForChain(launchChainId);
  const recent = useMemo(() => trades
    .slice()
    .sort((a, b) => Number(BigInt(b.blockNumber || "0") - BigInt(a.blockNumber || "0")) || Date.parse(b.createdAt || "0") - Date.parse(a.createdAt || "0"))
    .slice(0, 15), [trades]);

  return (
    <section className="recent-trades">
      <div className="recent-trades-head">
        <h2>Latest trades</h2>
        <span>{recent.length ? "Live" : "Waiting"}</span>
      </div>
      {recent.length === 0 ? (
        <div className="trade-feed-empty">No trades yet.</div>
      ) : (
        <div className="trade-feed">
          {recent.map((trade) => (
            <a
              className="trade-feed-row"
              href={`${chain.blockExplorers.default.url}/tx/${trade.txHash}`}
              key={`${trade.txHash}-${trade.side}-${trade.tokenAmount}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className={trade.side === "buy" ? "trade-side buy" : "trade-side sell"}>{trade.side}</span>
              <span className="trade-wallet">{trade.trader ? shortAddress(trade.trader) : "Unknown"}</span>
              <span className="trade-amount">{compactTokenAmount(trade.tokenAmount)} {symbol}</span>
              <strong>{trade.ethAmount}</strong>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function MarketStats({
  launch,
  trades
}: {
  launch: DeployedLaunch;
  trades: DeployedTrade[];
}) {
  const stats = useMemo(() => {
    const unique = new Set<string>();
    let buys = 0;
    let sells = 0;
    let boughtTokens = 0;
    let soldTokens = 0;

    for (const trade of trades) {
      if (trade.trader) unique.add(trade.trader.toLowerCase());
      const tokens = parseDisplayAmount(trade.tokenAmount);
      if (trade.side === "buy") {
        buys += 1;
        boughtTokens += tokens;
      } else {
        sells += 1;
        soldTokens += tokens;
      }
    }

    return {
      buys,
      sells,
      uniqueTraders: unique.size,
      netTokens: Math.max(boughtTokens - soldTokens, 0)
    };
  }, [trades]);

  return (
    <section className="market-stats-panel">
      <div className="market-stats-head">
        <h2>Recent activity</h2>
        <span>{launch.progress}% bonded</span>
      </div>
      <div className="market-stats-grid">
        <div><span>Buys</span><strong>{stats.buys}</strong></div>
        <div><span>Sells</span><strong>{stats.sells}</strong></div>
        <div><span>Traders</span><strong>{stats.uniqueTraders}</strong></div>
        <div><span>Net flow</span><strong>{compactTokenAmount(String(stats.netTokens))} {launch.symbol}</strong></div>
      </div>
    </section>
  );
}

function HolderDistribution({ launch, trades }: { launch: DeployedLaunch; trades: DeployedTrade[] }) {
  const panelRef = useRef<HTMLDetailsElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const { addresses, uniswapV4Addresses } = contractsForChain(launch.chainId);
  useEffect(() => {
    const element = panelRef.current;
    if (!element || shouldLoad) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);
  const candidateWallets = useMemo(() => {
    const netByWallet = new Map<`0x${string}`, number>();

    for (const trade of trades) {
      if (!trade.trader) continue;
      const tokens = parseDisplayAmount(trade.tokenAmount);
      const current = netByWallet.get(trade.trader) || 0;
      netByWallet.set(trade.trader, trade.side === "buy" ? current + tokens : current - tokens);
    }

    return Array.from(netByWallet.entries())
      .filter(([wallet, amount]) => amount > 0 && wallet.toLowerCase() !== launch.creator.toLowerCase())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([wallet]) => wallet);
  }, [launch.creator, trades]);

  const holderAddresses = useMemo(() => {
    const values = [
      launch.status === "Graduated" ? uniswapV4Addresses.poolManager : addresses.bondingCurveMarket,
      launch.creator,
      ...candidateWallets
    ].filter(Boolean) as `0x${string}`[];
    return Array.from(new Map(values.map((value) => [value.toLowerCase(), value])).values());
  }, [addresses.bondingCurveMarket, candidateWallets, launch.creator, launch.status, uniswapV4Addresses.poolManager]);

  const balances = useReadContracts({
    contracts: holderAddresses.map((holder) => ({
      address: launch.token,
      abi: b20TokenAbi,
      functionName: "balanceOf",
      args: [holder]
    })),
    query: { enabled: Boolean(shouldLoad && launch.token && holderAddresses.length), staleTime: 30_000 }
  });

  const rows = useMemo(() => {
    const balanceResults = balances.data as Array<{ result?: unknown }> | undefined;
    return holderAddresses
      .map((holder, index) => {
        const result = balanceResults?.[index]?.result;
        const balance = typeof result === "bigint" ? result : 0n;
        const amount = Number(formatEther(balance));
        const percent = TOTAL_SUPPLY > 0 ? (amount / TOTAL_SUPPLY) * 100 : 0;
        const isCurve = addresses.bondingCurveMarket?.toLowerCase() === holder.toLowerCase();
        const isUniswapPool = launch.status === "Graduated" && uniswapV4Addresses.poolManager.toLowerCase() === holder.toLowerCase();
        const isCreator = launch.creator.toLowerCase() === holder.toLowerCase();
        return {
          holder,
          label: isUniswapPool ? "Uniswap v4 pool" : isCurve ? "Bonding curve" : isCreator ? "Creator" : shortAddress(holder),
          balance,
          percent,
          tone: isUniswapPool ? "pool" : isCurve ? "curve" : isCreator ? "creator" : "holder"
        };
      })
      .filter((row) => row.balance > 0n)
      .sort((a, b) => Number(b.balance - a.balance))
      .slice(0, 20);
  }, [addresses.bondingCurveMarket, balances.data, holderAddresses, launch.creator, launch.status, uniswapV4Addresses.poolManager]);

  if (!shouldLoad) {
    return <details className="holder-distribution-panel market-accordion deferred-panel" ref={panelRef}><summary className="holder-distribution-head"><div><h2>Holder distribution</h2><p>Onchain balances</p></div><span>Loading</span></summary></details>;
  }
  if (!rows.length) return null;

  return (
    <details className="holder-distribution-panel market-accordion" ref={panelRef}>
      <summary className="holder-distribution-head">
        <div>
          <h2>Holder distribution</h2>
          <p>Onchain balances for the pool and recent participants</p>
        </div>
        <span>Top {rows.length}</span>
      </summary>
      <div className="holder-distribution-list">
        {rows.map((row, index) => (
          <div className="holder-row" key={row.holder}>
            <div className="holder-row-top">
              <em>{index + 1}</em>
              <span className={`holder-dot ${row.tone}`} />
              <strong>{row.label}</strong>
              <small>{formatHolderPercent(row.percent)}</small>
            </div>
            <div className="holder-bar">
              <span style={{ width: `${Math.min(row.percent, 100)}%` }} />
            </div>
            <div className="holder-row-bottom">
              <span>{compactTokenAmount(formatEther(row.balance))} {launch.symbol}</span>
              <code>{shortAddress(row.holder)}</code>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatHolderPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 0.01) return "<0.01%";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatChatAge(createdAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function TokenAvatar({ launch, className }: { launch: DeployedLaunch; className: string }) {
  const [failedImage, setFailedImage] = useState("");
  if (launch.imageURI && failedImage !== launch.imageURI) {
    return (
      <img
        className={`${className} token-avatar-image`}
        src={optimizedTokenImageUrl(launch.imageURI)}
        alt={launch.name}
        loading="lazy"
        decoding="async"
        onError={() => setFailedImage(launch.imageURI || "")}
      />
    );
  }
  return <span className={className}>{launch.symbol.slice(0, 4)}</span>;
}

function applySlippage(value: bigint, slippageBps: bigint) {
  return (value * (10_000n - slippageBps)) / 10_000n;
}

function parsePositiveEther(value: string) {
  try {
    const parsed = parseEther(value || "0");
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function formatQuote(value: bigint, unit: string) {
  const formatted = formatEther(value);
  if (unit !== "ETH") return `${compactTokenAmount(formatted)} ${unit}`;
  const [whole, fraction = ""] = formatEther(value).split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ${unit}`;
}

function formatTokenInput(value: bigint) {
  const [whole, fraction = ""] = formatEther(value).split(".");
  const trimmed = fraction.slice(0, 8).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function formatTokenBalance(value: bigint) {
  const numeric = Number(formatEther(value));
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}K`;
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function estimateGraduatedQuoteFromTrades(trades: DeployedTrade[], mode: "buy" | "sell", amountIn: bigint) {
  if (amountIn <= 0n) return undefined;
  const latest = trades
    .slice()
    .reverse()
    .find((trade) => parseDisplayAmount(trade.ethAmount) > 0 && parseDisplayAmount(trade.tokenAmount) > 0);
  if (!latest) return undefined;

  const eth = parseDisplayAmount(latest.ethAmount);
  const tokens = parseDisplayAmount(latest.tokenAmount);
  const ethPerToken = eth / tokens;
  const input = Number(formatEther(amountIn));
  if (!Number.isFinite(ethPerToken) || ethPerToken <= 0 || !Number.isFinite(input) || input <= 0) return undefined;

  const estimated = mode === "buy" ? input / ethPerToken : input * ethPerToken;
  return parseApproximateEther(estimated);
}

function parseApproximateEther(value: number) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const fixed = value >= 1
    ? value.toFixed(18)
    : value.toPrecision(18);
  const normalized = decimalStringFromNumber(fixed);
  try {
    const parsed = parseEther(normalized);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decimalStringFromNumber(value: string) {
  if (!/[eE]/.test(value)) return value.replace(/0+$/, "").replace(/\.$/, "") || "0";
  const [coefficient, exponentText = "0"] = value.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const [whole, fraction = ""] = coefficient.replace("+", "").split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  const point = whole.length + exponent;
  if (point <= 0) return `0.${"0".repeat(Math.abs(point))}${digits}`.replace(/0+$/, "").replace(/\.$/, "") || "0";
  if (point >= digits.length) return `${digits}${"0".repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function estimateCurveSnapshot(raisedValue: string) {
  const grossRaised = Math.max(0, parseDisplayAmount(raisedValue));
  const initialVirtualEth = 1.25;
  const virtualEth = initialVirtualEth + grossRaised * (1 - CURVE_FEE_RATE);
  const marketCapEth = (virtualEth * virtualEth) / initialVirtualEth;
  const priceEth = marketCapEth / TOTAL_SUPPLY;
  return {
    marketCap: `${decimalStringFromNumber(marketCapEth.toPrecision(18))} ETH`,
    price: `${decimalStringFromNumber(priceEth.toPrecision(18))} ETH`
  };
}

function TradeChart({ trades, status, symbol, ethUsd }: { trades: DeployedTrade[]; status: DeployedLaunch["status"]; symbol: string; ethUsd: number | null }) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const shouldFitChartRef = useRef(true);
  const userTouchedChartRef = useRef(false);
  const [chartMode, setChartMode] = useState<"marketCap" | "price">("marketCap");
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [darkChart, setDarkChart] = useState(false);
  const { candles, volume, latestValue } = useMemo(
    () => buildChartData(trades, chartMode, ethUsd, intervalMinutes, status === "Graduated"),
    [trades, chartMode, ethUsd, intervalMinutes, status]
  );
  const chartDataRef = useRef({ candles, volume });
  chartDataRef.current = { candles, volume };
  const chartTitle = chartMode === "marketCap" ? `${symbol} market cap` : `${symbol} price`;

  useEffect(() => {
    const syncTheme = () => setDarkChart(document.documentElement.dataset.theme === "dark");
    syncTheme();
    window.addEventListener("bluefun-theme-change", syncTheme);
    return () => window.removeEventListener("bluefun-theme-change", syncTheme);
  }, []);

  function resetChart() {
    userTouchedChartRef.current = false;
    shouldFitChartRef.current = true;
    focusLatestCandles(chartApiRef.current, candles.length);
  }

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;
    const chartContainer = container;
    let chart: IChartApi | undefined;
    let disposed = false;

    shouldFitChartRef.current = true;
    userTouchedChartRef.current = false;
    const markTouched = () => {
      userTouchedChartRef.current = true;
      shouldFitChartRef.current = false;
    };

    async function setupChart() {
      const { CandlestickSeries, ColorType, createChart, HistogramSeries } = await import("lightweight-charts");
      if (disposed) return;
      const createdChart = createChart(chartContainer, {
      autoSize: true,
      height: 340,
      layout: {
        background: { type: ColorType.Solid, color: darkChart ? "#080809" : "#f8faff" },
        textColor: darkChart ? "#b8bdc9" : "#5f6f95",
        fontFamily: "Inter, ui-sans-serif, system-ui"
      },
      grid: {
        vertLines: { color: darkChart ? "rgba(255, 255, 255, 0.075)" : "rgba(184, 198, 230, 0.45)" },
        horzLines: { color: darkChart ? "rgba(255, 255, 255, 0.075)" : "rgba(184, 198, 230, 0.45)" }
      },
      rightPriceScale: {
        borderColor: darkChart ? "#29292f" : "#d8e0f3",
        scaleMargins: { top: 0.12, bottom: 0.28 }
      },
      timeScale: {
        borderColor: darkChart ? "#29292f" : "#d8e0f3",
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: "rgba(0, 0, 255, 0.28)" },
        horzLine: { color: "rgba(0, 0, 255, 0.28)" }
      },
      localization: {
        priceFormatter: (price: number) => chartMode === "marketCap" ? compactUsd(price) : formatUsdPrice(price)
      }
    });
      chart = createdChart;
      chartApiRef.current = createdChart;

      const candleSeries = createdChart.addSeries(CandlestickSeries, {
      upColor: "#17b26a",
      downColor: "#e5484d",
      borderUpColor: "#17b26a",
      borderDownColor: "#e5484d",
      wickUpColor: "#17b26a",
      wickDownColor: "#e5484d",
      priceFormat: {
        type: "custom",
        formatter: (price: number) => chartMode === "marketCap" ? compactUsd(price) : formatUsdPrice(price),
        minMove: chartMode === "marketCap" ? 0.01 : 0.0000000001
      }
    });
    candleSeriesRef.current = candleSeries;

      const volumeSeries = createdChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "rgba(0, 0, 255, 0.18)",
      lastValueVisible: false,
      priceLineVisible: false
    });
    volumeSeriesRef.current = volumeSeries;

      createdChart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      visible: false,
      borderVisible: false
    });

      const initialData = chartDataRef.current;
      candleSeries.setData(initialData.candles as CandlestickData<UTCTimestamp>[]);
      volumeSeries.setData(initialData.volume as HistogramData<UTCTimestamp>[]);
      if (initialData.candles.length > 0) {
        focusLatestCandles(createdChart, initialData.candles.length);
        shouldFitChartRef.current = false;
      }

      chartContainer.addEventListener("wheel", markTouched, { passive: true });
      chartContainer.addEventListener("pointerdown", markTouched);
      chartContainer.addEventListener("touchstart", markTouched, { passive: true });
    }

    void setupChart();

    return () => {
      disposed = true;
      chartContainer.removeEventListener("wheel", markTouched);
      chartContainer.removeEventListener("pointerdown", markTouched);
      chartContainer.removeEventListener("touchstart", markTouched);
      chart?.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [chartMode, darkChart]);

  useEffect(() => {
    if (!chartApiRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;
    candleSeriesRef.current.setData(candles as CandlestickData<UTCTimestamp>[]);
    volumeSeriesRef.current.setData(volume as HistogramData<UTCTimestamp>[]);
    if (shouldFitChartRef.current && !userTouchedChartRef.current && candles.length > 0) {
      focusLatestCandles(chartApiRef.current, candles.length);
      shouldFitChartRef.current = false;
    }
  }, [candles, volume]);

  return (
    <div className="tv-chart-wrap">
      <div className="tv-chart-header">
        <div>
          <span className="muted">{chartTitle}</span>
          <strong>{latestValue ? chartMode === "marketCap" ? compactUsd(latestValue) : formatUsdPrice(latestValue) : "-"}</strong>
        </div>
        <div className="chart-mode-tabs" role="tablist" aria-label="Chart view">
          <button aria-selected={chartMode === "marketCap"} className={chartMode === "marketCap" ? "active" : ""} onClick={() => setChartMode("marketCap")} role="tab" type="button">
            Market Cap
          </button>
          <button aria-selected={chartMode === "price"} className={chartMode === "price" ? "active" : ""} onClick={() => setChartMode("price")} role="tab" type="button">
            Price
          </button>
        </div>
        <div className="chart-interval-tabs" role="tablist" aria-label="Candle interval">
          {[1, 5, 15].map((minutes) => (
            <button
              aria-selected={intervalMinutes === minutes}
              className={intervalMinutes === minutes ? "active" : ""}
              key={minutes}
              onClick={() => {
                shouldFitChartRef.current = true;
                userTouchedChartRef.current = false;
                setIntervalMinutes(minutes);
              }}
              role="tab"
              type="button"
            >
              {minutes}m
            </button>
          ))}
          <button onClick={resetChart} type="button" aria-label="Reset chart view"><RotateCcw size={13} /></button>
        </div>
        <div className="tv-chart-legend">
          <span><i className="legend-up" /> Buys</span>
          <span><i className="legend-down" /> Sells</span>
        </div>
      </div>
      <div ref={chartRef} className="tv-chart" aria-label={`${chartTitle} chart`} />
      {!ethUsd || candles.length === 0 ? (
        <div className="chart-overlay-note">
          <strong>{!ethUsd ? "Loading USD market data." : "USD chart will appear after the first trade."}</strong>
          <span>{!ethUsd ? "ETH/USD pricing is used for chart and market cap display." : "Candles and volume update live from buy and sell events."}</span>
        </div>
      ) : null}
    </div>
  );
}

function focusLatestCandles(chart: IChartApi | null, candleCount: number) {
  if (!chart || candleCount === 0) return;
  const visibleBars = Math.min(Math.max(candleCount, 12), 60);
  chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, candleCount - visibleBars - 2),
    to: candleCount + 2
  });
}

function buildChartData(
  trades: DeployedTrade[],
  chartMode: "marketCap" | "price",
  ethUsd: number | null,
  intervalMinutes: number,
  graduated: boolean
) {
  let virtualEthReserve = 1.25;
  let virtualTokenReserve = TOTAL_SUPPLY;
  const hasV4Trades = trades.some((trade) => trade.source === "uniswap_v4");
  const chartTrades = graduated && hasV4Trades ? trades.filter((trade) => trade.source === "uniswap_v4") : trades;
  const buckets = new Map<number, {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    side: DeployedTrade["side"];
  }>();
  let lastAcceptedValue = 0;

  chartTrades
    .slice()
    .sort((a, b) => Number(BigInt(a.blockNumber || "0") - BigInt(b.blockNumber || "0")) || Date.parse(a.createdAt || "0") - Date.parse(b.createdAt || "0"))
    .forEach((trade, index) => {
    const eth = parseDisplayAmount(trade.ethAmount);
    const tokens = parseDisplayAmount(trade.tokenAmount);
    if (eth <= 0 || tokens <= 0) return;

    const indexedMarketCapEth = trade.marketCapEth ? parseDisplayAmount(trade.marketCapEth) : 0;
    let marketCapEth = indexedMarketCapEth;
    if (marketCapEth <= 0 && trade.source === "uniswap_v4") {
      marketCapEth = (eth / tokens) * TOTAL_SUPPLY;
    }
    if (marketCapEth <= 0) {
      if (trade.side === "buy") {
        const netEth = eth * (1 - CURVE_FEE_RATE);
        virtualEthReserve += netEth;
        virtualTokenReserve = Math.max(virtualTokenReserve - tokens, 1);
      } else {
        const grossEth = eth / (1 - CURVE_FEE_RATE);
        virtualEthReserve = Math.max(virtualEthReserve - grossEth, 0.000001);
        virtualTokenReserve += tokens;
      }
      marketCapEth = (virtualEthReserve / virtualTokenReserve) * TOTAL_SUPPLY;
    }

    const marketCapUsd = marketCapEth * (ethUsd ?? 0);
    const value = chartMode === "marketCap" ? marketCapUsd : marketCapUsd / TOTAL_SUPPLY;
    if (lastAcceptedValue > 0 && (value > lastAcceptedValue * 8 || value < lastAcceptedValue / 8)) return;
    lastAcceptedValue = value;
    const timestamp = parseTradeTimestamp(trade.createdAt, index);
    const intervalSeconds = intervalMinutes * 60;
    const bucketTime = Math.floor(timestamp / intervalSeconds) * intervalSeconds;
    const bucket = buckets.get(bucketTime);

    if (!bucket) {
      buckets.set(bucketTime, {
        open: value,
        high: value,
        low: value,
        close: value,
        volume: eth,
        side: trade.side
      });
      return;
    }

    bucket.high = Math.max(bucket.high, value);
    bucket.low = Math.min(bucket.low, value);
    bucket.close = value;
    bucket.volume += eth;
    bucket.side = trade.side;
  });

  let previousClose = 0;
  const sorted = Array.from(buckets.entries()).sort(([a], [b]) => a - b);
  const candles = sorted.map(([time, bucket]) => {
    const open = previousClose > 0 ? previousClose : bucket.open;
    const close = bucket.close;
    const candle = {
      time: time as UTCTimestamp,
      open,
      high: Math.max(bucket.high, open, close),
      low: Math.min(bucket.low, open, close),
      close
    };
    previousClose = close;
    return candle;
  });
  const volume = sorted.map(([time, bucket]) => ({
    time: time as UTCTimestamp,
    value: bucket.volume,
    color: bucket.side === "buy" ? "rgba(23, 178, 106, 0.38)" : "rgba(229, 72, 77, 0.34)"
  }));

  return {
    candles,
    volume,
    latestValue: sorted.at(-1)?.[1].close ?? 0
  };
}

function parseTradeTimestamp(value: string, index: number) {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  return Math.floor(Date.now() / 1000) - (60 * Math.max(0, 100 - index));
}

function friendlyTradeError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("rejected") || lower.includes("denied")) {
    return "Request cancelled in wallet.";
  }
  if (lower.includes("insufficient funds")) return "Not enough ETH for this order.";
  if (lower.includes("slippage")) return "Price moved. Try again with a smaller amount or higher slippage.";
  return "Order could not be completed. Please check your wallet and try again.";
}
