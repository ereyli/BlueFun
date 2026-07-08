"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { formatEther, maxUint256, parseEther, zeroAddress } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ArrowDownUp, Copy, ExternalLink, Loader2, LockKeyhole, RotateCcw, Settings, ShieldCheck, Sparkles } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
import { addresses, b20TokenAbi, bondingCurveAbi, graduationManagerAbi } from "@/lib/contracts";
import {
  CURVE_FEE_RATE,
  TOTAL_SUPPLY,
  calculatePriceImpact,
  compactTokenAmount,
  compactUsd,
  formatEthAmount,
  formatPercent,
  formatUsdFromEthText,
  formatUsdPrice,
  parseDisplayAmount,
  shortAddress
} from "@/lib/market-math";
import type { DeployedLaunch, DeployedTrade } from "@/lib/onchain-launches";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";

export function MarketClient({ id, launch, trades }: { id: string; launch?: DeployedLaunch; trades: DeployedTrade[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(200n);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const { address, isConnected } = useAccount();
  const { data: hash, error, writeContract, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const parsedAmount = parsePositiveEther(amount);
  const ethBalance = useBalance({
    address,
    query: { enabled: Boolean(address) }
  });
  const readEnabled = Boolean(addresses.bondingCurveMarket && parsedAmount > 0n);
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
  const creatorFeeBalance = useReadContract({
    address: addresses.bondingCurveMarket,
    abi: bondingCurveAbi,
    functionName: "pendingFees",
    args: [launch?.creator ?? zeroAddress],
    query: { enabled: Boolean(addresses.bondingCurveMarket && launch?.creator) }
  });
  const tokenAllowance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "allowance",
    args: [address ?? zeroAddress, addresses.bondingCurveMarket ?? zeroAddress],
    query: { enabled: Boolean(mode === "sell" && launch?.token && address && addresses.bondingCurveMarket) }
  });
  const tokenBalance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    query: { enabled: Boolean(mode === "sell" && launch?.token && address) }
  });
  const creatorTokenBalance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "balanceOf",
    args: [launch?.creator ?? zeroAddress],
    query: { enabled: Boolean(launch?.token && launch?.creator) }
  });
  const curveTokenBalance = useReadContract({
    address: launch?.token,
    abi: b20TokenAbi,
    functionName: "balanceOf",
    args: [addresses.bondingCurveMarket ?? zeroAddress],
    query: { enabled: Boolean(launch?.token && addresses.bondingCurveMarket) }
  });
  const quotedOut = mode === "buy" ? buyQuote.data?.[0] : sellQuote.data?.[0];
  const minOut = quotedOut ? applySlippage(quotedOut, slippageBps) : 0n;
  const quoteLoading = mode === "buy" ? buyQuote.isLoading : sellQuote.isLoading;
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
  const tradeDisabled = !addresses.bondingCurveMarket || !isConnected || isWorking || parsedAmount === 0n || exceedsEthBalance || exceedsSellBalance || (!needsSellApproval && minOut === 0n);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    const timeout = window.setTimeout(() => router.refresh(), 1_200);
    return () => window.clearTimeout(timeout);
  }, [receipt.isSuccess, router]);

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), 6_000);
    return () => window.clearInterval(interval);
  }, [router]);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const scope = process.env.NEXT_PUBLIC_INDEXER_SCOPE;
    if (!supabaseUrl || !supabaseAnonKey || !scope) return;

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
          if ((payload.new as { scope?: string } | null)?.scope === scope || (payload.old as { scope?: string } | null)?.scope === scope) {
            router.refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, router]);

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
    const interval = window.setInterval(loadEthPrice, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  function buy() {
    if (!addresses.bondingCurveMarket || parsedAmount === 0n || minOut === 0n) return;
    writeContract({
      address: addresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "buy",
      args: [BigInt(id), minOut, BigInt(Math.floor(Date.now() / 1000) + 900)],
      value: parsedAmount
    });
  }

  function approveSell() {
    if (!addresses.bondingCurveMarket || !launch || parsedAmount === 0n) return;
    writeContract({
      address: launch.token,
      abi: b20TokenAbi,
      functionName: "approve",
      args: [addresses.bondingCurveMarket, maxUint256]
    });
  }

  function sell() {
    if (!addresses.bondingCurveMarket || parsedAmount === 0n || minOut === 0n) return;
    writeContract({
      address: addresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "sell",
      args: [BigInt(id), parsedAmount, minOut, BigInt(Math.floor(Date.now() / 1000) + 900)]
    });
  }

  function graduate() {
    if (!addresses.graduationManager || !launch || launch.status !== "Ready") return;
    writeContract({
      address: addresses.graduationManager,
      abi: graduationManagerAbi,
      functionName: "graduate",
      args: [BigInt(id)]
    });
  }

  function claimFees() {
    if (!addresses.bondingCurveMarket) return;
    writeContract({
      address: addresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "claimFees"
    });
  }

  function setSellPercent(percent: bigint) {
    if (sellBalance === 0n) return;
    setAmount(formatTokenInput((sellBalance * percent) / 100n));
  }

  if (!launch) {
    return <div className="empty">Loading market from Base Sepolia...</div>;
  }

  return (
    <div className="trade-layout">
      <section>
        <div className="market-header-card">
          <div className="market-header-main">
            <TokenAvatar launch={launch} className="profile-art" />
            <div className="market-title-block">
              <div className="market-title-row">
                <h1>{launch.name}</h1>
                <span className={launch.status === "Live" ? "token-status live" : "token-status"}>{launch.status}</span>
              </div>
              <div className="market-meta">
                <span>${launch.symbol}</span>
                <span>{launch.age} ago</span>
                <span>{launch.creator.slice(0, 6)}...{launch.creator.slice(-4)}</span>
              </div>
            </div>
            <div className="market-actions">
              <a className="button primary" href={`https://sepolia.basescan.org/token/${launch.token}`} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />BaseScan
              </a>
              <button className="button" onClick={() => navigator.clipboard.writeText(launch.token)}>
                <Copy size={16} />{launch.token.slice(0, 6)}...{launch.token.slice(-4)}
              </button>
            </div>
          </div>
          <div className="market-header-stats">
            <div><span>Market cap</span><strong>{formatUsdFromEthText(launch.marketCap, ethUsd)}</strong></div>
            <div><span>Price</span><strong>{formatUsdFromEthText(launch.price, ethUsd, true)}</strong></div>
            <div><span>Raised</span><strong>{launch.raised}</strong></div>
            <div><span>Bonded</span><strong>{launch.progress}%</strong></div>
          </div>
          <div className="progress"><span style={{ width: `${launch.progress}%` }} /></div>
        </div>

        <div className="chart-panel">
          <div className="curve-state compact">
            <TradeChart trades={trades} symbol={launch.symbol} ethUsd={ethUsd} />
            <MarketStats
              launch={launch}
              trades={trades}
              creatorFeeBalance={creatorFeeBalance.data ?? 0n}
              creatorTokenBalance={creatorTokenBalance.data ?? 0n}
              curveTokenBalance={curveTokenBalance.data ?? 0n}
            />
            <ProjectInfo launch={launch} />
            <RecentTrades trades={trades} symbol={launch.symbol} />
          </div>
        </div>
      </section>

      <aside className="trade-box">
        <section className="trade-card">
          <div className="trade-tabs">
            <button className={mode === "buy" ? "active" : ""} onClick={() => setMode("buy")} type="button">Buy</button>
            <button className={mode === "sell" ? "active" : ""} onClick={() => setMode("sell")} type="button">Sell</button>
          </div>
          <div className="form">
            {!isConnected ? (
              <div className="notice compact">
                <strong>Connect wallet</strong>
                <span>Wallet connection is required before trading.</span>
              </div>
            ) : null}
            <div className="field">
              <div className="field-head">
                <label>{mode === "buy" ? "ETH in" : `${launch.symbol} amount`}</label>
                {mode === "sell" ? (
                  <button className="balance-button" onClick={() => setSellPercent(100n)} type="button">
                    Balance {formatTokenBalance(sellBalance)} {launch.symbol}
                  </button>
                ) : null}
              </div>
              <input className="amount-input" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className="quote-box">
              <div className="quote-head">
                <span>{quoteLoading ? "Quoting..." : mode === "buy" ? "Estimated tokens" : "Estimated ETH"}</span>
                <button
                  className={settingsOpen ? "settings-button active" : "settings-button"}
                  onClick={() => setSettingsOpen((open) => !open)}
                  type="button"
                  aria-label="Trade settings"
                >
                  <Settings size={15} />
                </button>
              </div>
              <strong>{quotedOut ? formatQuote(quotedOut, mode === "buy" ? launch.symbol : "ETH") : "-"}</strong>
              <small>Minimum after {Number(slippageBps) / 100}% slippage: {minOut ? formatQuote(minOut, mode === "buy" ? launch.symbol : "ETH") : "-"}</small>
              <small>Price impact: {formatPercent(priceImpact)}</small>
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
                <div className="quick-grid">
                  <button type="button" onClick={() => setAmount("0.01")}>0.01</button>
                  <button type="button" onClick={() => setAmount("0.05")}>0.05</button>
                  <button type="button" onClick={() => setAmount("0.1")}>0.1</button>
                </div>
                <button className="button primary" disabled={tradeDisabled} onClick={buy}>
                  {isWorking ? <Loader2 className="spin" size={16} /> : <ArrowDownUp size={16} />}
                  {isPending ? "Confirm in wallet" : receipt.isLoading ? "Buying" : exceedsEthBalance ? "Insufficient ETH" : `Buy $${launch.symbol}`}
                </button>
              </>
            ) : (
              <>
                <div className="quick-grid sell-grid">
                  <button type="button" onClick={() => setSellPercent(25n)}>25%</button>
                  <button type="button" onClick={() => setSellPercent(50n)}>50%</button>
                  <button type="button" onClick={() => setSellPercent(75n)}>75%</button>
                  <button type="button" onClick={() => setSellPercent(100n)}>Max</button>
                </div>
                <button className="button primary" disabled={tradeDisabled} onClick={needsSellApproval ? approveSell : sell}>
                  {isWorking ? <Loader2 className="spin" size={16} /> : <ArrowDownUp size={16} />}
                  {isPending
                    ? "Confirm in wallet"
                    : receipt.isLoading
                      ? needsSellApproval ? "Approving" : "Selling"
                      : exceedsSellBalance ? "Insufficient balance" : needsSellApproval ? `Approve $${launch.symbol}` : `Sell $${launch.symbol}`}
                </button>
                <span className="trade-helper">
                  {needsSellApproval ? "One-time unlimited approval for smoother sells." : "Approval ready."}
                </span>
              </>
            )}
            <div className="trade-status-stack">
              {quoteLoading ? <TradeStatus tone="info">Quote is updating.</TradeStatus> : null}
              {isPending ? <TradeStatus tone="info">Confirm this order in your wallet.</TradeStatus> : null}
              {hash && !receipt.isSuccess && !isPending ? <TradeStatus tone="info">Order submitted. Waiting for confirmation.</TradeStatus> : null}
              {receipt.isSuccess ? <TradeStatus tone="success">Order confirmed. Market data is refreshing.</TradeStatus> : null}
              {exceedsEthBalance ? <TradeStatus tone="danger">Not enough ETH for this order.</TradeStatus> : null}
              {exceedsSellBalance ? <TradeStatus tone="danger">Insufficient token balance.</TradeStatus> : null}
              {error ? <TradeStatus tone="danger">{friendlyTradeError(error.message)}</TradeStatus> : null}
            </div>
          </div>
        </section>

        <section className="safety-card">
          <div className="safety-head">
            <span><ShieldCheck size={16} /> Safety</span>
            <strong>{launch.status}</strong>
          </div>
          <div className="safety-grid">
            <span><ShieldCheck size={15} /> Supply capped</span>
            <span><LockKeyhole size={15} /> LP locked at bond</span>
            <span><Sparkles size={15} /> Adminless after bond</span>
          </div>
          <div className="safety-foot">
            <span>Curve fee</span>
            <strong>1.00%</strong>
            <span>Creator</span>
            <strong>{launch.creator.slice(0, 6)}...{launch.creator.slice(-4)}</strong>
          </div>
          {launch.status === "Ready" ? (
            <button className="button primary wide" disabled={!addresses.graduationManager || !isConnected || isWorking} onClick={graduate}>
              {isWorking ? <Loader2 className="spin" size={16} /> : <LockKeyhole size={16} />}
              {isPending ? "Confirm in wallet" : receipt.isLoading ? "Graduating" : "Graduate to Uniswap v4"}
            </button>
          ) : null}
        </section>

        <section className="side-compact-card">
          <div className="side-card-head">
            <span>Creator earnings</span>
            <strong>{accountFeeBalance.data ? formatQuote(accountFeeBalance.data, "ETH") : "0 ETH"}</strong>
          </div>
          <button
            className="button primary wide"
            disabled={!isConnected || isWorking || !accountFeeBalance.data}
            onClick={claimFees}
            type="button"
          >
            {isWorking ? <Loader2 className="spin" size={16} /> : null}
            {isPending ? "Confirm in wallet" : receipt.isLoading ? "Claiming" : "Claim fees"}
          </button>
        </section>
      </aside>
    </div>
  );
}

function TradeStatus({ children, tone }: { children: React.ReactNode; tone: "info" | "success" | "danger" }) {
  return <p className={`trade-status ${tone}`}>{children}</p>;
}

function ProjectInfo({ launch }: { launch: DeployedLaunch }) {
  const links = [
    { label: "Website", href: launch.website },
    { label: "X", href: launch.twitter },
    { label: "Telegram", href: launch.telegram },
    { label: "Discord", href: launch.discord }
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  if (!launch.description && links.length === 0) return null;

  return (
    <section className="project-info-panel">
      <div className="project-info-head">
        <h2>Project</h2>
        <span>{links.length ? `${links.length} links` : "Description"}</span>
      </div>
      {launch.description ? <p>{launch.description}</p> : null}
      {links.length ? (
        <div className="project-link-row">
          {links.map((link) => (
            <a href={link.href} key={link.label} target="_blank" rel="noreferrer">
              {link.label}<ExternalLink size={13} />
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RecentTrades({ trades, symbol }: { trades: DeployedTrade[]; symbol: string }) {
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
              href={`https://sepolia.basescan.org/tx/${trade.txHash}`}
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
  trades,
  creatorFeeBalance,
  creatorTokenBalance,
  curveTokenBalance
}: {
  launch: DeployedLaunch;
  trades: DeployedTrade[];
  creatorFeeBalance: bigint;
  creatorTokenBalance: bigint;
  curveTokenBalance: bigint;
}) {
  const stats = useMemo(() => {
    const unique = new Set<string>();
    let buys = 0;
    let sells = 0;
    let boughtTokens = 0;
    let soldTokens = 0;
    const netByWallet = new Map<string, number>();

    for (const trade of trades) {
      if (trade.trader) unique.add(trade.trader.toLowerCase());
      const tokens = parseDisplayAmount(trade.tokenAmount);
      if (trade.side === "buy") {
        buys += 1;
        boughtTokens += tokens;
        if (trade.trader) netByWallet.set(trade.trader, (netByWallet.get(trade.trader) || 0) + tokens);
      } else {
        sells += 1;
        soldTokens += tokens;
        if (trade.trader) netByWallet.set(trade.trader, (netByWallet.get(trade.trader) || 0) - tokens);
      }
    }

    const topCurveWallets = Array.from(netByWallet.entries())
      .filter(([, value]) => value > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    return {
      buys,
      sells,
      uniqueTraders: unique.size,
      netTokens: Math.max(boughtTokens - soldTokens, 0),
      topCurveWallets
    };
  }, [trades]);

  return (
    <section className="market-stats-panel">
      <div className="market-stats-head">
        <h2>Market stats</h2>
        <span>{launch.progress}% bonded</span>
      </div>
      <div className="market-stats-grid">
        <div><span>Total buys</span><strong>{stats.buys}</strong></div>
        <div><span>Total sells</span><strong>{stats.sells}</strong></div>
        <div><span>Unique traders</span><strong>{stats.uniqueTraders}</strong></div>
        <div><span>Creator fees</span><strong>{formatEthAmount(creatorFeeBalance)}</strong></div>
      </div>
      <div className="distribution-strip">
        <div><span>Creator holding</span><strong>{compactTokenAmount(formatEther(creatorTokenBalance))} {launch.symbol}</strong></div>
        <div><span>Curve contract</span><strong>{compactTokenAmount(formatEther(curveTokenBalance))} {launch.symbol}</strong></div>
        <div><span>Curve-est. holders</span><strong>{stats.topCurveWallets.length || "0"}</strong></div>
      </div>
      {stats.topCurveWallets.length ? (
        <div className="holder-mini-list">
          {stats.topCurveWallets.map(([wallet, amount]) => (
            <span key={wallet}>{shortAddress(wallet)} <strong>{compactTokenAmount(String(amount))}</strong></span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TokenAvatar({ launch, className }: { launch: DeployedLaunch; className: string }) {
  if (launch.imageURI) {
    return <img className={`${className} token-avatar-image`} src={ipfsToGatewayUrl(launch.imageURI)} alt={launch.name} />;
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

function TradeChart({ trades, symbol, ethUsd }: { trades: DeployedTrade[]; symbol: string; ethUsd: number | null }) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const shouldFitChartRef = useRef(true);
  const userTouchedChartRef = useRef(false);
  const [chartMode, setChartMode] = useState<"marketCap" | "price">("marketCap");
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const { candles, volume, latestValue } = useMemo(() => buildChartData(trades, chartMode, ethUsd, intervalMinutes), [trades, chartMode, ethUsd, intervalMinutes]);
  const chartTitle = chartMode === "marketCap" ? `${symbol} market cap` : `${symbol} price`;
  function resetChart() {
    userTouchedChartRef.current = false;
    shouldFitChartRef.current = true;
    chartApiRef.current?.timeScale().fitContent();
  }

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    shouldFitChartRef.current = true;
    userTouchedChartRef.current = false;
    const markTouched = () => {
      userTouchedChartRef.current = true;
      shouldFitChartRef.current = false;
    };

    const chart = createChart(container, {
      autoSize: true,
      height: 340,
      layout: {
        background: { type: ColorType.Solid, color: "#f8faff" },
        textColor: "#5f6f95",
        fontFamily: "Inter, ui-sans-serif, system-ui"
      },
      grid: {
        vertLines: { color: "rgba(184, 198, 230, 0.45)" },
        horzLines: { color: "rgba(184, 198, 230, 0.45)" }
      },
      rightPriceScale: {
        borderColor: "#d8e0f3",
        scaleMargins: { top: 0.12, bottom: 0.28 }
      },
      timeScale: {
        borderColor: "#d8e0f3",
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: "rgba(0, 0, 255, 0.28)" },
        horzLine: { color: "rgba(0, 0, 255, 0.28)" }
      },
      localization: {
        priceFormatter: (price: number) => chartMode === "marketCap" ? `${compactUsd(price)} MC` : formatUsdPrice(price)
      }
    });
    chartApiRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#17b26a",
      downColor: "#e5484d",
      borderUpColor: "#17b26a",
      borderDownColor: "#e5484d",
      wickUpColor: "#17b26a",
      wickDownColor: "#e5484d",
      priceFormat: {
        type: "custom",
        formatter: (price: number) => chartMode === "marketCap" ? `${compactUsd(price)} MC` : formatUsdPrice(price),
        minMove: chartMode === "marketCap" ? 0.01 : 0.0000000001
      }
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "rgba(0, 0, 255, 0.18)",
      lastValueVisible: false,
      priceLineVisible: false
    });
    volumeSeriesRef.current = volumeSeries;

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
      visible: false,
      borderVisible: false
    });

    container.addEventListener("wheel", markTouched, { passive: true });
    container.addEventListener("pointerdown", markTouched);
    container.addEventListener("touchstart", markTouched, { passive: true });

    return () => {
      container.removeEventListener("wheel", markTouched);
      container.removeEventListener("pointerdown", markTouched);
      container.removeEventListener("touchstart", markTouched);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [chartMode]);

  useEffect(() => {
    if (!chartApiRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;
    candleSeriesRef.current.setData(candles as CandlestickData<UTCTimestamp>[]);
    volumeSeriesRef.current.setData(volume as HistogramData<UTCTimestamp>[]);
    if (shouldFitChartRef.current && !userTouchedChartRef.current && candles.length > 0) {
      chartApiRef.current.timeScale().fitContent();
      shouldFitChartRef.current = false;
    }
  }, [candles, volume]);

  return (
    <div className="tv-chart-wrap">
      <div className="tv-chart-header">
        <div>
          <span className="muted">{chartTitle}</span>
          <strong>{latestValue ? chartMode === "marketCap" ? `${compactUsd(latestValue)} MC` : formatUsdPrice(latestValue) : "-"}</strong>
        </div>
        <div className="chart-mode-tabs" role="tablist" aria-label="Chart view">
          <button className={chartMode === "marketCap" ? "active" : ""} onClick={() => setChartMode("marketCap")} type="button">
            Market Cap
          </button>
          <button className={chartMode === "price" ? "active" : ""} onClick={() => setChartMode("price")} type="button">
            Price
          </button>
        </div>
        <div className="chart-interval-tabs" role="tablist" aria-label="Candle interval">
          {[1, 5, 15].map((minutes) => (
            <button
              className={intervalMinutes === minutes ? "active" : ""}
              key={minutes}
              onClick={() => {
                shouldFitChartRef.current = true;
                userTouchedChartRef.current = false;
                setIntervalMinutes(minutes);
              }}
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

function buildChartData(trades: DeployedTrade[], chartMode: "marketCap" | "price", ethUsd: number | null, intervalMinutes: number) {
  let virtualEthReserve = 1.25;
  let virtualTokenReserve = TOTAL_SUPPLY;
  const buckets = new Map<number, {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    side: DeployedTrade["side"];
  }>();

  trades
    .slice()
    .sort((a, b) => Number(BigInt(a.blockNumber || "0") - BigInt(b.blockNumber || "0")) || Date.parse(a.createdAt || "0") - Date.parse(b.createdAt || "0"))
    .forEach((trade, index) => {
    const eth = parseDisplayAmount(trade.ethAmount);
    const tokens = parseDisplayAmount(trade.tokenAmount);
    if (eth <= 0 || tokens <= 0) return;

    let marketCapEth = trade.marketCapEth ? parseDisplayAmount(trade.marketCapEth) : 0;
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
