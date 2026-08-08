"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  formatUnits,
  getAddress,
  isAddress,
  maxUint256,
  parseUnits,
  zeroAddress,
  type Address,
  type PublicClient
} from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X
} from "@/components/bluefun-icons";
import {
  applySlippage,
  blueDexDeployment,
  candidatePaths,
  customTokenStorageKey,
  erc20Abi,
  factoryAbi,
  normalizeImportedToken,
  pairAbi,
  priceImpactBps,
  routerAbi,
  sameToken,
  shortAddress,
  tokenLogoUrl,
  tokenKey,
  wrappedAddress,
  type BlueDexDeployment,
  type BlueDexToken
} from "@/lib/bluedex";

type Quote = { amountOut: bigint; path: Address[]; impactBps?: number };
type TxNotice = { kind: "pending" | "success" | "error"; message: string; hash?: Address };
const SELECT_TOKEN: BlueDexToken = { address: zeroAddress, symbol: "Select", name: "Choose a token", decimals: 18, placeholder: true };

export function BlueDexClient() {
  const params = useSearchParams();
  const walletChainId = useChainId();
  const requestedChain = params.get("chain")?.toLowerCase();
  const chainId: 8453 | 4663 = requestedChain === "robinhood" || (!requestedChain && walletChainId === 4663) ? 4663 : 8453;
  const deployment = blueDexDeployment(chainId);
  const [tab, setTab] = useState<"swap" | "pool">(params.get("tab") === "pool" ? "pool" : "swap");
  const [customTokens, setCustomTokens] = useState<BlueDexToken[]>([]);
  const [tokensReadyChain, setTokensReadyChain] = useState(0);
  const tokens = useMemo(() => uniqueTokens([...deployment.tokens, ...customTokens]), [deployment.tokens, customTokens]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(customTokenStorageKey(chainId)) || "[]") as Partial<BlueDexToken>[];
      setCustomTokens(parsed.map(normalizeImportedToken).filter((token): token is BlueDexToken => Boolean(token)).map((token) => ({ ...token, logo: tokenLogoUrl(chainId, token.address) })));
    } catch {
      setCustomTokens([]);
    }
    setTokensReadyChain(chainId);
  }, [chainId]);

  const saveCustomToken = useCallback((token: BlueDexToken) => {
    setCustomTokens((current) => {
      const next = uniqueTokens([...current, { ...token, custom: true }]);
      localStorage.setItem(customTokenStorageKey(chainId), JSON.stringify(next));
      return next;
    });
  }, [chainId]);

  const removeCustomToken = useCallback((token: BlueDexToken) => {
    setCustomTokens((current) => {
      const next = current.filter((item) => item.address.toLowerCase() !== token.address.toLowerCase());
      localStorage.setItem(customTokenStorageKey(chainId), JSON.stringify(next));
      return next;
    });
  }, [chainId]);

  return (
    <div className="bluedex-page">
      <section className="bluedex-hero">
        <div>
          <span className="bluedex-eyebrow"><i /> Live onchain</span>
          <h1>Trade simply. Own the liquidity.</h1>
          <p>BlueDEX is B20&apos;s native constant-product AMM, powered by canonical Uniswap V2 contracts.</p>
        </div>
      </section>

      <section className={`bluedex-shell ${tab === "pool" ? "pool-view" : "trade-view"}`}>
        <div className="bluedex-tabs" role="tablist">
          <button aria-selected={tab === "swap"} className={tab === "swap" ? "active" : ""} onClick={() => setTab("swap")} role="tab" type="button">Swap</button>
          <button aria-selected={tab === "pool"} className={tab === "pool" ? "active" : ""} onClick={() => setTab("pool")} role="tab" type="button">Pools</button>
        </div>
        {tokensReadyChain !== chainId ? <div className="bluedex-panel-loading"><Loader2 className="spin" size={19}/> Loading token list…</div> : tab === "swap" ? <div className="bluedex-trade-layout"><SwapPanel deployment={deployment} initialTokenQuery={params.get("q") || ""} key={`swap-${chainId}`} tokens={tokens} onImport={saveCustomToken} onRemove={removeCustomToken}/></div> : <PoolPanel deployment={deployment} key={`pool-${chainId}`} tokens={tokens} onImport={saveCustomToken} onRemove={removeCustomToken}/>}
      </section>

      <section className="bluedex-assurance">
        <span><ShieldCheck size={17}/><b>Canonical V2</b><small>Unmodified AMM math</small></span>
        <span><Info size={17}/><b>0.30% LP fee</b><small>Included in every swap</small></span>
        <a href={`${deployment.explorer}/address/${deployment.router}`} rel="noreferrer" target="_blank"><ExternalLink size={16}/><b>Verified contracts</b><small>{shortAddress(deployment.router)}</small></a>
      </section>
    </div>
  );
}

function SwapPanel({ deployment, tokens, onImport, onRemove, initialTokenQuery }: TokenEnvironmentProps & { initialTokenQuery: string }) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [tokenIn, setTokenIn] = useState(tokens[0]);
  const [tokenOut, setTokenOut] = useState(defaultCounterToken(tokens, tokens[0], deployment));
  const [amountIn, setAmountIn] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [selector, setSelector] = useState<"in" | "out" | undefined>(() => isAddress(initialTokenQuery) ? "out" : undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50);
  const [deadlineMinutes, setDeadlineMinutes] = useState(20);
  const [notice, setNotice] = useState<TxNotice>();
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const inputBalance = useTokenBalance(client, address, tokenIn, deployment, refreshKey);
  const outputBalance = useTokenBalance(client, address, tokenOut, deployment, refreshKey);
  const parsedInput = parseTokenAmount(amountIn, tokenIn.decimals);

  useEffect(() => {
    const interval = window.setInterval(() => setRefreshKey((value) => value + 1), 12_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setQuoteError("");
      if (!client || tokenIn.placeholder || tokenOut.placeholder || !parsedInput || parsedInput <= 0n || sameToken(tokenIn, tokenOut, deployment)) {
        setQuote(undefined);
        return;
      }
      setQuoteLoading(true);
      try {
        const candidates = candidatePaths(tokenIn, tokenOut, deployment);
        const results = await Promise.all(candidates.map(async (path) => {
          try {
            const amounts = await client.readContract({ address: deployment.router, abi: routerAbi, functionName: "getAmountsOut", args: [parsedInput, path] });
            return { amountOut: amounts[amounts.length - 1], path };
          } catch {
            return undefined;
          }
        }));
        const best = results.filter((result): result is { amountOut: bigint; path: Address[] } => Boolean(result)).sort((a, b) => a.amountOut > b.amountOut ? -1 : 1)[0];
        if (!best) throw new Error("No BlueDEX liquidity route exists for this pair yet.");
        const reserves = best.path.length === 2 ? await directReserves(client, deployment, best.path[0], best.path[1]) : undefined;
        if (!cancelled) setQuote({ ...best, impactBps: priceImpactBps(parsedInput, best.amountOut, reserves?.reserveIn, reserves?.reserveOut) });
      } catch (error) {
        if (!cancelled) {
          setQuote(undefined);
          setQuoteError(shortError(error));
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [client, deployment, parsedInput, refreshKey, tokenIn, tokenOut]);

  const amountOut = quote ? formatInputValue(quote.amountOut, tokenOut.decimals, 8) : "";
  const insufficientBalance = parsedInput !== undefined && inputBalance !== undefined && parsedInput > inputBalance;
  const minimumReceived = quote ? applySlippage(quote.amountOut, slippageBps) : 0n;

  function flipTokens() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut);
    setQuote(undefined);
  }

  async function executeSwap() {
    if (!address || !client || !parsedInput || !quote) return;
    setSubmitting(true);
    setNotice({ kind: "pending", message: "Preparing your swap…" });
    try {
      if (!tokenIn.native) await ensureApproval({ client, owner: address, token: tokenIn.address, spender: deployment.router, required: parsedInput, chainId: deployment.chainId, writeContractAsync, setNotice });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);
      const common = { address: deployment.router, abi: routerAbi, chainId: deployment.chainId } as const;
      let hash: Address;
      if (tokenIn.native) {
        hash = await writeContractAsync({ ...common, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [minimumReceived, quote.path, address, deadline], value: parsedInput });
      } else if (tokenOut.native) {
        hash = await writeContractAsync({ ...common, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args: [parsedInput, minimumReceived, quote.path, address, deadline] });
      } else {
        hash = await writeContractAsync({ ...common, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [parsedInput, minimumReceived, quote.path, address, deadline] });
      }
      setNotice({ kind: "pending", message: "Swap submitted. Waiting for confirmation…", hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The swap reverted onchain.");
      setNotice({ kind: "success", message: `Swapped ${amountIn} ${tokenIn.symbol} for ${amountOut} ${tokenOut.symbol}.`, hash });
      setAmountIn("");
      setQuote(undefined);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setNotice({ kind: "error", message: shortError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const primary = !isConnected ? { label: "Connect wallet above", disabled: true, action: undefined }
    : walletChainId !== deployment.chainId ? { label: switching ? "Switching network…" : `Switch to ${deployment.chainId === 8453 ? "Base" : "Robinhood"}`, disabled: switching, action: () => switchChainAsync({ chainId: deployment.chainId }) }
    : tokenIn.placeholder || tokenOut.placeholder ? { label: "Select a token", disabled: true, action: undefined }
    : sameToken(tokenIn, tokenOut, deployment) ? { label: "Choose different tokens", disabled: true, action: undefined }
    : !parsedInput ? { label: "Enter an amount", disabled: true, action: undefined }
    : insufficientBalance ? { label: `Insufficient ${tokenIn.symbol}`, disabled: true, action: undefined }
    : quoteLoading ? { label: "Finding best route…", disabled: true, action: undefined }
    : !quote ? { label: "No liquidity route", disabled: true, action: undefined }
    : { label: submitting ? "Processing…" : "Swap", disabled: submitting, action: executeSwap };

  return (
    <div className="bluedex-card">
      <div className="swap-mode-bar"><div><button className="active" type="button">Swap</button><button disabled title="Coming in a later release" type="button">Limit</button></div><span><i/> Auto router</span></div>
      <div className="bluedex-card-head"><div><h2>Swap tokens</h2><p>BlueDEX finds the best direct or WETH-routed quote</p></div><button aria-label="Transaction settings" className={settingsOpen ? "icon-button active" : "icon-button"} onClick={() => setSettingsOpen((value) => !value)} type="button"><Settings size={18}/></button></div>
      {settingsOpen ? <TradeSettings deadlineMinutes={deadlineMinutes} onDeadline={setDeadlineMinutes} onSlippage={setSlippageBps} slippageBps={slippageBps}/> : null}
      <TokenAmount token={tokenIn} value={amountIn} onChange={setAmountIn} onSelect={() => setSelector("in")} balance={inputBalance} onMax={() => inputBalance !== undefined && setAmountIn(formatUnits(inputBalance, tokenIn.decimals))}/>
      <button aria-label="Switch tokens" className="bluedex-flip" onClick={flipTokens} type="button"><ArrowDownUp size={19}/></button>
      <TokenAmount token={tokenOut} value={amountOut} onSelect={() => setSelector("out")} balance={outputBalance} readOnly loading={quoteLoading}/>
      {quote ? <div className="bluedex-quote-details">
        <Detail label="Rate" value={`1 ${tokenIn.symbol} ≈ ${formatRate(parsedInput || 0n, quote.amountOut, tokenIn.decimals, tokenOut.decimals)} ${tokenOut.symbol}`}/>
        <Detail label="Minimum received" value={`${formatTokenValue(minimumReceived, tokenOut.decimals, 8)} ${tokenOut.symbol}`}/>
        <Detail label="Route" value={quote.path.length === 2 ? `${tokenIn.symbol} → ${tokenOut.symbol}` : `${tokenIn.symbol} → WETH → ${tokenOut.symbol}`}/>
        <Detail label="Price impact + LP fee" tone={(quote.impactBps || 0) > 500 ? "danger" : (quote.impactBps || 0) > 100 ? "warning" : "good"} value={quote.impactBps === undefined ? "—" : `${(quote.impactBps / 100).toFixed(2)}%`}/>
      </div> : quoteError ? <div className="bluedex-inline-warning"><AlertTriangle size={16}/><span>{quoteError}</span></div> : null}
      <button className="bluedex-primary" disabled={primary.disabled} onClick={primary.action} type="button">{submitting || switching ? <Loader2 className="spin" size={18}/> : null}{primary.label}</button>
      <TxStatus deployment={deployment} notice={notice}/>
      <div className="bluedex-fee-line"><span>Liquidity provider fee</span><b>0.30%</b></div>
      {selector ? <TokenSelector deployment={deployment} excluded={selector === "in" ? tokenOut : tokenIn} initialQuery={initialTokenQuery} onClose={() => setSelector(undefined)} onImport={onImport} onRemove={onRemove} onSelect={(token) => { if (selector === "in") setTokenIn(token); else setTokenOut(token); setSelector(undefined); }} tokens={tokens}/> : null}
    </div>
  );
}

function PoolPanel(props: TokenEnvironmentProps) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  return <div className="pool-experience">
    <ActivePoolsPanel deployment={props.deployment} tokens={props.tokens}/>
    <div className="bluedex-card pool-card">
      <div className="bluedex-card-head"><div><span className="card-kicker">Manage liquidity</span><h2>Add or remove liquidity</h2><p>Choose a pair and manage your BlueDEX V2 position</p></div></div>
      <div className="pool-mode-tabs"><button className={mode === "add" ? "active" : ""} onClick={() => setMode("add")} type="button"><Plus size={15}/> Add liquidity</button><button className={mode === "remove" ? "active" : ""} onClick={() => setMode("remove")} type="button">Remove liquidity</button></div>
      {mode === "add" ? <AddLiquidity {...props}/> : <RemoveLiquidity {...props}/>}
    </div>
  </div>;
}

type ActivePool = {
  pair: Address;
  token0: BlueDexToken;
  token1: BlueDexToken;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  userBalance: bigint;
};

function ActivePoolsPanel({ deployment, tokens }: { deployment: BlueDexDeployment; tokens: BlueDexToken[] }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: deployment.chainId });
  const [pools, setPools] = useState<ActivePool[]>([]);
  const [totalPools, setTotalPools] = useState<bigint>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void (async () => {
      if (!client) return;
      try {
        const length = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allPairsLength" });
        if (cancelled) return;
        setTotalPools(length);
        const visibleCount = Math.min(Number(length), 20);
        const start = Number(length) - visibleCount;
        const pairAddresses = await Promise.all(Array.from({ length: visibleCount }, (_, offset) => client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allPairs", args: [BigInt(start + offset)] })));
        const loaded = await Promise.all(pairAddresses.reverse().map(async (pair) => {
          const [token0Address, token1Address, reserves, totalSupply, userBalance] = await Promise.all([
            client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
            client.readContract({ address: pair, abi: pairAbi, functionName: "token1" }),
            client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
            client.readContract({ address: pair, abi: pairAbi, functionName: "totalSupply" }),
            address ? client.readContract({ address: pair, abi: pairAbi, functionName: "balanceOf", args: [address] }) : Promise.resolve(0n)
          ]);
          const [token0, token1] = await Promise.all([
            readPoolToken(client, token0Address, tokens),
            readPoolToken(client, token1Address, tokens)
          ]);
          return { pair, token0, token1, reserve0: reserves[0], reserve1: reserves[1], totalSupply, userBalance };
        }));
        if (!cancelled) setPools(loaded);
      } catch (reason) {
        if (!cancelled) setError(shortError(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, client, deployment, refreshKey, tokens]);

  const positions = pools.filter((pool) => pool.userBalance > 0n);

  return <section className="active-pools-panel">
    <div className="active-pools-head"><div><span className="card-kicker">Liquidity overview</span><h2>Pool positions</h2><p>Live reserves and your ownership across every BlueDEX pool</p></div><button aria-label="Refresh pools" onClick={() => setRefreshKey((value) => value + 1)} type="button"><Loader2 className={loading ? "spin" : ""} size={16}/></button></div>
    <div className="pool-stats"><span><small>Active pools</small><strong>{totalPools === undefined ? "—" : totalPools.toString()}</strong></span><span><small>Your positions</small><strong>{address ? positions.length : "Connect wallet"}</strong></span><span><small>LP fee</small><strong>0.30% · auto-compounds</strong></span><a href={`${deployment.explorer}/address/${deployment.factory}`} rel="noreferrer" target="_blank"><small>Factory</small><strong>{shortAddress(deployment.factory)} <ExternalLink size={11}/></strong></a></div>
    <div className="pool-table-head"><span>Pool</span><span>Pool reserves</span><span>LP supply</span><span>Your position</span><span>Fee</span><span/></div>
    <div className="active-pool-list">
      {loading && pools.length === 0 ? <div className="pools-empty"><Loader2 className="spin" size={20}/><span>Reading BlueDEX pools…</span></div> : null}
      {!loading && pools.length === 0 && !error ? <div className="pools-empty new"><span className="empty-pool-art"><Plus size={20}/></span><strong>Be the first liquidity provider</strong><span>No pools have been created on this network yet.</span><button onClick={() => document.querySelector<HTMLButtonElement>('.bluedex-tabs button[role="tab"]:nth-child(2)')?.click()} type="button">Create a pool</button></div> : null}
      {error ? <div className="pools-empty error"><AlertTriangle size={18}/><span>{error}</span></div> : null}
      {pools.map((pool) => {
        const shareBps = pool.totalSupply > 0n ? pool.userBalance * 1_000_000n / pool.totalSupply : 0n;
        const owned0 = pool.totalSupply > 0n ? pool.reserve0 * pool.userBalance / pool.totalSupply : 0n;
        const owned1 = pool.totalSupply > 0n ? pool.reserve1 * pool.userBalance / pool.totalSupply : 0n;
        return <a className={`active-pool-row ${pool.userBalance > 0n ? "has-position" : ""}`} href={`${deployment.explorer}/address/${pool.pair}`} key={pool.pair} rel="noreferrer" target="_blank">
        <span className="pool-token-stack"><TokenLogo token={pool.token0}/><TokenLogo token={pool.token1}/></span>
        <span className="pool-pair-name"><strong>{pool.token0.symbol} / {pool.token1.symbol}</strong><small>{shortAddress(pool.pair)}</small></span>
        <span className="pool-reserves"><strong>{formatCompactToken(pool.reserve0, pool.token0.decimals)} {pool.token0.symbol}</strong><small>{formatCompactToken(pool.reserve1, pool.token1.decimals)} {pool.token1.symbol}</small></span>
        <span className="pool-lp-supply"><strong>{formatCompactToken(pool.totalSupply, 18)}</strong><small>UNI-V2 tokens</small></span>
        <span className="pool-position"><strong>{pool.userBalance > 0n ? `${formatShare(shareBps)}% share` : address ? "No position" : "Connect wallet"}</strong><small>{pool.userBalance > 0n ? `${formatCompactToken(owned0, pool.token0.decimals)} ${pool.token0.symbol} + ${formatCompactToken(owned1, pool.token1.decimals)} ${pool.token1.symbol}` : "Fees accrue inside LP value"}</small></span>
        <span className="pool-fee-tag">0.30%</span><ExternalLink size={14}/>
      </a>;})}
    </div>
    {pools.length > 0 ? <div className="pool-list-foot"><span><i/> Live onchain reserves</span><small>V2 trading fees are automatically reinvested into each LP position · Showing {pools.length} of {totalPools?.toString() || pools.length}</small></div> : null}
  </section>;
}

function AddLiquidity({ deployment, tokens, onImport, onRemove }: TokenEnvironmentProps) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [tokenA, setTokenA] = useState(tokens[0]);
  const [tokenB, setTokenB] = useState(defaultCounterToken(tokens, tokens[0], deployment));
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [selector, setSelector] = useState<"a" | "b">();
  const [slippageBps, setSlippageBps] = useState(50);
  const [deadlineMinutes, setDeadlineMinutes] = useState(20);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<TxNotice>();
  const [submitting, setSubmitting] = useState(false);
  const [poolState, setPoolState] = useState<{ pair: Address; reserveA: bigint; reserveB: bigint; totalSupply: bigint }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const balanceA = useTokenBalance(client, address, tokenA, deployment, refreshKey);
  const balanceB = useTokenBalance(client, address, tokenB, deployment, refreshKey);
  const parsedA = parseTokenAmount(amountA, tokenA.decimals);
  const parsedB = parseTokenAmount(amountB, tokenB.decimals);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!client || sameToken(tokenA, tokenB, deployment)) return setPoolState(undefined);
      try {
        const a = wrappedAddress(tokenA, deployment); const b = wrappedAddress(tokenB, deployment);
        const pair = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "getPair", args: [a, b] });
        if (pair === zeroAddress) return !cancelled && setPoolState(undefined);
        const [token0, reserves, totalSupply] = await Promise.all([
          client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
          client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
          client.readContract({ address: pair, abi: pairAbi, functionName: "totalSupply" })
        ]);
        const aligned = token0.toLowerCase() === a.toLowerCase() ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
        if (!cancelled) setPoolState({ pair, reserveA: aligned[0], reserveB: aligned[1], totalSupply });
      } catch { if (!cancelled) setPoolState(undefined); }
    })();
    return () => { cancelled = true; };
  }, [client, deployment, refreshKey, tokenA, tokenB]);

  function updateA(value: string) {
    setAmountA(value);
    const parsed = parseTokenAmount(value, tokenA.decimals);
    if (parsed && poolState?.reserveA && poolState.reserveB) setAmountB(formatInputValue(parsed * poolState.reserveB / poolState.reserveA, tokenB.decimals, tokenB.decimals));
  }

  function updateB(value: string) {
    setAmountB(value);
    const parsed = parseTokenAmount(value, tokenB.decimals);
    if (parsed && poolState?.reserveB && poolState.reserveA) setAmountA(formatInputValue(parsed * poolState.reserveA / poolState.reserveB, tokenA.decimals, tokenA.decimals));
  }

  async function addLiquidity() {
    if (!address || !client || !parsedA || !parsedB) return;
    setSubmitting(true); setNotice({ kind: "pending", message: "Preparing liquidity transaction…" });
    try {
      if (!tokenA.native) await ensureApproval({ client, owner: address, token: tokenA.address, spender: deployment.router, required: parsedA, chainId: deployment.chainId, writeContractAsync, setNotice });
      if (!tokenB.native) await ensureApproval({ client, owner: address, token: tokenB.address, spender: deployment.router, required: parsedB, chainId: deployment.chainId, writeContractAsync, setNotice });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);
      const minA = applySlippage(parsedA, slippageBps); const minB = applySlippage(parsedB, slippageBps);
      const common = { address: deployment.router, abi: routerAbi, chainId: deployment.chainId } as const;
      let hash: Address;
      if (tokenA.native || tokenB.native) {
        const nativeIsA = tokenA.native;
        const token = nativeIsA ? tokenB : tokenA;
        const tokenAmount = nativeIsA ? parsedB : parsedA;
        const nativeAmount = nativeIsA ? parsedA : parsedB;
        hash = await writeContractAsync({ ...common, functionName: "addLiquidityETH", args: [token.address, tokenAmount, nativeIsA ? minB : minA, nativeIsA ? minA : minB, address, deadline], value: nativeAmount });
      } else {
        hash = await writeContractAsync({ ...common, functionName: "addLiquidity", args: [tokenA.address, tokenB.address, parsedA, parsedB, minA, minB, address, deadline] });
      }
      setNotice({ kind: "pending", message: "Liquidity submitted. Waiting for confirmation…", hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Liquidity transaction reverted.");
      setNotice({ kind: "success", message: poolState ? "Liquidity added to the pool." : "New BlueDEX pool created and funded.", hash });
      setAmountA(""); setAmountB(""); setRefreshKey((value) => value + 1);
    } catch (error) { setNotice({ kind: "error", message: shortError(error) }); }
    finally { setSubmitting(false); }
  }

  const invalid = tokenA.placeholder || tokenB.placeholder || sameToken(tokenA, tokenB, deployment);
  const insufficient = (parsedA && balanceA !== undefined && parsedA > balanceA) || (parsedB && balanceB !== undefined && parsedB > balanceB);
  const primary = !isConnected ? { label: "Connect wallet above", disabled: true, action: undefined }
    : walletChainId !== deployment.chainId ? { label: switching ? "Switching network…" : `Switch to ${deployment.chainId === 8453 ? "Base" : "Robinhood"}`, disabled: switching, action: () => switchChainAsync({ chainId: deployment.chainId }) }
    : tokenA.placeholder || tokenB.placeholder ? { label: "Select two tokens", disabled: true, action: undefined }
    : invalid ? { label: "Choose different tokens", disabled: true, action: undefined }
    : !parsedA || !parsedB ? { label: "Enter both amounts", disabled: true, action: undefined }
    : insufficient ? { label: "Insufficient balance", disabled: true, action: undefined }
    : { label: submitting ? "Processing…" : poolState ? "Add liquidity" : "Create pool & add liquidity", disabled: submitting, action: addLiquidity };

  return <div className="liquidity-form">
    <div className="liquidity-toolbar"><span>{poolState ? <>Pool found <b>{shortAddress(poolState.pair)}</b></> : "A new pool will be created"}</span><button aria-label="Liquidity settings" className="icon-button" onClick={() => setSettingsOpen((value) => !value)} type="button"><Settings size={17}/></button></div>
    {settingsOpen ? <TradeSettings deadlineMinutes={deadlineMinutes} onDeadline={setDeadlineMinutes} onSlippage={setSlippageBps} slippageBps={slippageBps}/> : null}
    <TokenAmount label="Token A" token={tokenA} value={amountA} onChange={updateA} onSelect={() => setSelector("a")} balance={balanceA} onMax={() => balanceA !== undefined && updateA(formatUnits(balanceA, tokenA.decimals))}/>
    <div className="liquidity-plus"><Plus size={16}/></div>
    <TokenAmount label="Token B" token={tokenB} value={amountB} onChange={updateB} onSelect={() => setSelector("b")} balance={balanceB} onMax={() => balanceB !== undefined && updateB(formatUnits(balanceB, tokenB.decimals))}/>
    {poolState && parsedA && parsedB ? <div className="pool-preview"><Detail label="Current ratio" value={`1 ${tokenA.symbol} = ${formatRate(poolState.reserveA, poolState.reserveB, tokenA.decimals, tokenB.decimals)} ${tokenB.symbol}`}/><Detail label="Slippage protection" value={`${(slippageBps / 100).toFixed(2)}%`}/></div> : null}
    <button className="bluedex-primary" disabled={primary.disabled} onClick={primary.action} type="button">{submitting || switching ? <Loader2 className="spin" size={18}/> : null}{primary.label}</button>
    <TxStatus deployment={deployment} notice={notice}/>
    {selector ? <TokenSelector deployment={deployment} excluded={selector === "a" ? tokenB : tokenA} onClose={() => setSelector(undefined)} onImport={onImport} onRemove={onRemove} onSelect={(token) => { if (selector === "a") setTokenA(token); else setTokenB(token); setSelector(undefined); }} tokens={tokens}/> : null}
  </div>;
}

function RemoveLiquidity({ deployment, tokens, onImport, onRemove }: TokenEnvironmentProps) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const client = usePublicClient({ chainId: deployment.chainId });
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [tokenA, setTokenA] = useState(tokens[0]);
  const [tokenB, setTokenB] = useState(defaultCounterToken(tokens, tokens[0], deployment));
  const [selector, setSelector] = useState<"a" | "b">();
  const [percent, setPercent] = useState(100);
  const [position, setPosition] = useState<{ pair: Address; balance: bigint; totalSupply: bigint; amountA: bigint; amountB: bigint }>();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<TxNotice>();
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const slippageBps = 50;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      if (!client || !address || sameToken(tokenA, tokenB, deployment)) return setPosition(undefined);
      try {
        const a = wrappedAddress(tokenA, deployment); const b = wrappedAddress(tokenB, deployment);
        const pair = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "getPair", args: [a, b] });
        if (pair === zeroAddress) return !cancelled && setPosition(undefined);
        const [token0, reserves, totalSupply, balance] = await Promise.all([
          client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
          client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
          client.readContract({ address: pair, abi: pairAbi, functionName: "totalSupply" }),
          client.readContract({ address: pair, abi: pairAbi, functionName: "balanceOf", args: [address] })
        ]);
        const aligned = token0.toLowerCase() === a.toLowerCase() ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
        if (!cancelled) setPosition({ pair, balance, totalSupply, amountA: totalSupply ? aligned[0] * balance / totalSupply : 0n, amountB: totalSupply ? aligned[1] * balance / totalSupply : 0n });
      } catch { if (!cancelled) setPosition(undefined); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [address, client, deployment, refreshKey, tokenA, tokenB]);

  const liquidity = position ? position.balance * BigInt(percent) / 100n : 0n;
  const expectedA = position ? position.amountA * BigInt(percent) / 100n : 0n;
  const expectedB = position ? position.amountB * BigInt(percent) / 100n : 0n;

  async function removeLiquidity() {
    if (!address || !client || !position || liquidity <= 0n) return;
    setSubmitting(true); setNotice({ kind: "pending", message: "Preparing LP withdrawal…" });
    try {
      await ensureApproval({ client, owner: address, token: position.pair, spender: deployment.router, required: liquidity, chainId: deployment.chainId, writeContractAsync, setNotice, lp: true });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      const common = { address: deployment.router, abi: routerAbi, chainId: deployment.chainId } as const;
      let hash: Address;
      if (tokenA.native || tokenB.native) {
        const nativeIsA = tokenA.native; const token = nativeIsA ? tokenB : tokenA;
        hash = await writeContractAsync({ ...common, functionName: "removeLiquidityETHSupportingFeeOnTransferTokens", args: [token.address, liquidity, applySlippage(nativeIsA ? expectedB : expectedA, slippageBps), applySlippage(nativeIsA ? expectedA : expectedB, slippageBps), address, deadline] });
      } else {
        hash = await writeContractAsync({ ...common, functionName: "removeLiquidity", args: [tokenA.address, tokenB.address, liquidity, applySlippage(expectedA, slippageBps), applySlippage(expectedB, slippageBps), address, deadline] });
      }
      setNotice({ kind: "pending", message: "Withdrawal submitted. Waiting for confirmation…", hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Liquidity withdrawal reverted.");
      setNotice({ kind: "success", message: "Liquidity removed and underlying tokens returned.", hash });
      setRefreshKey((value) => value + 1);
    } catch (error) { setNotice({ kind: "error", message: shortError(error) }); }
    finally { setSubmitting(false); }
  }

  const primary = !isConnected ? { label: "Connect wallet above", disabled: true, action: undefined }
    : walletChainId !== deployment.chainId ? { label: switching ? "Switching network…" : `Switch to ${deployment.chainId === 8453 ? "Base" : "Robinhood"}`, disabled: switching, action: () => switchChainAsync({ chainId: deployment.chainId }) }
    : !position || position.balance === 0n ? { label: "No LP position found", disabled: true, action: undefined }
    : { label: submitting ? "Processing…" : "Remove liquidity", disabled: submitting || percent === 0, action: removeLiquidity };

  return <div className="liquidity-form remove-form">
    <div className="pair-picker"><button onClick={() => setSelector("a")} type="button"><TokenLogo token={tokenA}/><b>{tokenA.symbol}</b><ChevronDown size={14}/></button><span>/</span><button onClick={() => setSelector("b")} type="button"><TokenLogo token={tokenB}/><b>{tokenB.symbol}</b><ChevronDown size={14}/></button></div>
    {loading ? <div className="position-empty"><Loader2 className="spin" size={20}/> Reading your LP position…</div> : position && position.balance > 0n ? <>
      <div className="position-card"><div><span>Your LP tokens</span><strong>{formatTokenValue(position.balance, 18, 8)}</strong><small>{shortAddress(position.pair)}</small></div><div className="token-pair-art"><TokenLogo token={tokenA}/><TokenLogo token={tokenB}/></div></div>
      <div className="percentage-head"><span>Amount to remove</span><strong>{percent}%</strong></div>
      <input aria-label="Liquidity percentage" className="percentage-range" max="100" min="0" onChange={(event) => setPercent(Number(event.target.value))} step="1" type="range" value={percent}/>
      <div className="percentage-presets">{[25, 50, 75, 100].map((value) => <button className={percent === value ? "active" : ""} key={value} onClick={() => setPercent(value)} type="button">{value}%</button>)}</div>
      <div className="pool-preview"><Detail label={`Expected ${tokenA.symbol}`} value={formatTokenValue(expectedA, tokenA.decimals, 8)}/><Detail label={`Expected ${tokenB.symbol}`} value={formatTokenValue(expectedB, tokenB.decimals, 8)}/></div>
    </> : <div className="position-empty"><Info size={20}/><strong>No position found</strong><span>Select the two tokens in your BlueDEX pool.</span></div>}
    <button className="bluedex-primary" disabled={primary.disabled} onClick={primary.action} type="button">{submitting || switching ? <Loader2 className="spin" size={18}/> : null}{primary.label}</button>
    <TxStatus deployment={deployment} notice={notice}/>
    {selector ? <TokenSelector deployment={deployment} excluded={selector === "a" ? tokenB : tokenA} onClose={() => setSelector(undefined)} onImport={onImport} onRemove={onRemove} onSelect={(token) => { if (selector === "a") setTokenA(token); else setTokenB(token); setSelector(undefined); }} tokens={tokens}/> : null}
  </div>;
}

type TokenEnvironmentProps = {
  deployment: BlueDexDeployment;
  tokens: BlueDexToken[];
  onImport: (token: BlueDexToken) => void;
  onRemove: (token: BlueDexToken) => void;
};

function TokenSelector({ deployment, tokens, excluded, onSelect, onClose, onImport, onRemove, initialQuery = "" }: TokenEnvironmentProps & { excluded: BlueDexToken; onSelect: (token: BlueDexToken) => void; onClose: () => void; initialQuery?: string }) {
  const client = usePublicClient({ chainId: deployment.chainId });
  const [query, setQuery] = useState(initialQuery);
  const [candidate, setCandidate] = useState<BlueDexToken>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const normalized = query.trim();
  const filtered = tokens.filter((token) => !sameToken(token, excluded, deployment) && `${token.symbol} ${token.name} ${token.address}`.toLowerCase().includes(normalized.toLowerCase()));

  useEffect(() => {
    let cancelled = false;
    setCandidate(undefined); setError("");
    if (!client || !isAddress(normalized) || tokens.some((token) => token.address.toLowerCase() === normalized.toLowerCase())) return;
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const address = getAddress(normalized);
        const [name, symbol, decimals] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "name" }),
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" })
        ]);
        const imported = normalizeImportedToken({ address, name, symbol, decimals });
        const token = imported ? { ...imported, logo: tokenLogoUrl(deployment.chainId, address) } : imported;
        if (!token) throw new Error("Invalid ERC-20 metadata.");
        if (!cancelled) setCandidate(token);
      } catch { if (!cancelled) setError("No valid ERC-20 contract found at this address."); }
      finally { if (!cancelled) setLoading(false); }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [client, deployment.chainId, normalized, tokens]);

  return <div className="token-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="presentation"><div aria-modal="true" className="token-modal" role="dialog">
    <div className="token-modal-head"><div><h3>Select a token</h3><p>{deployment.chainId === 8453 ? "Base" : "Robinhood Chain"}</p></div><button aria-label="Close token selector" onClick={onClose} type="button"><X size={18}/></button></div>
    <label className="token-search"><Search size={17}/><input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Search name or paste contract" value={query}/>{query ? <button aria-label="Clear search" onClick={() => setQuery("")} type="button"><X size={14}/></button> : null}</label>
    <div className="token-list">
      {filtered.map((token) => <button className="token-list-row" key={tokenKey(token)} onClick={() => onSelect(token)} type="button"><TokenLogo token={token}/><span><strong>{token.symbol}</strong><small>{token.name}</small></span>{token.native ? <em>Native</em> : <code>{shortAddress(token.address)}</code>}{token.custom ? <i aria-label="Remove imported token" onClick={(event) => { event.stopPropagation(); onRemove(token); }} role="button" tabIndex={0}><Trash2 size={14}/></i> : null}</button>)}
      {loading ? <div className="token-import-state"><Loader2 className="spin" size={18}/> Reading token contract…</div> : null}
      {candidate ? <div className="token-import-card"><div><AlertTriangle size={17}/><span><strong>Import token</strong><small>Anyone can create a token with any name. Verify the address.</small></span></div><button onClick={() => { onImport(candidate); onSelect(candidate); }} type="button"><TokenLogo token={candidate}/><span><b>{candidate.symbol}</b><small>{candidate.name}</small></span><em>Import</em></button><code>{candidate.address}</code></div> : null}
      {error ? <div className="token-import-state error"><AlertTriangle size={17}/>{error}</div> : null}
      {!loading && !candidate && !error && filtered.length === 0 ? <div className="token-import-state">Paste a valid ERC-20 contract address to import it.</div> : null}
    </div>
    <div className="token-modal-foot"><ShieldCheck size={15}/> Token imports are saved only in this browser.</div>
  </div></div>;
}

function TokenAmount({ label, token, value, onChange, onSelect, balance, onMax, readOnly = false, loading = false }: { label?: string; token: BlueDexToken; value: string; onChange?: (value: string) => void; onSelect: () => void; balance?: bigint; onMax?: () => void; readOnly?: boolean; loading?: boolean }) {
  return <div className="token-amount-card">
    <div className="token-amount-label"><span>{label ?? (readOnly ? "Buy" : "Sell")}</span><span>Balance: <b>{balance === undefined ? "—" : formatTokenValue(balance, token.decimals, 5)}</b>{onMax && balance !== undefined ? <button onClick={onMax} type="button">MAX</button> : null}</span></div>
    <div className="token-amount-main"><input aria-label={`${token.symbol} amount`} inputMode="decimal" onChange={(event) => onChange?.(sanitizeAmount(event.target.value))} placeholder="0" readOnly={readOnly} value={loading ? "" : value}/><button onClick={onSelect} type="button"><TokenLogo token={token}/><strong>{token.symbol}</strong><ChevronDown size={15}/></button>{loading ? <Loader2 className="token-quote-loader spin" size={19}/> : null}</div>
  </div>;
}

function TokenLogo({ token }: { token: BlueDexToken }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [token.logo]);
  if (token.placeholder) return <span className="token-logo placeholder"><Plus size={15}/></span>;
  if (token.logo && !imageFailed) return <span className="token-logo"><img alt="" onError={() => setImageFailed(true)} src={token.logo}/></span>;
  if (token.native) return <span className="token-logo native">Ξ</span>;
  const hue = Number.parseInt(token.address.slice(2, 8), 16) % 360;
  return <span className="token-logo generated" style={{ "--token-hue": hue } as React.CSSProperties}>{token.symbol.slice(0, 2).toUpperCase()}</span>;
}

function TradeSettings({ slippageBps, deadlineMinutes, onSlippage, onDeadline }: { slippageBps: number; deadlineMinutes: number; onSlippage: (value: number) => void; onDeadline: (value: number) => void }) {
  return <div className="trade-settings"><div><span>Max slippage</span><div className="slippage-options">{[10, 50, 100].map((value) => <button className={slippageBps === value ? "active" : ""} key={value} onClick={() => onSlippage(value)} type="button">{(value / 100).toFixed(value === 10 ? 1 : 0)}%</button>)}<label><input aria-label="Custom slippage" max="50" min="0" onChange={(event) => onSlippage(Math.round(Number(event.target.value || 0) * 100))} step="0.1" type="number" value={(slippageBps / 100).toString()}/><b>%</b></label></div></div><label className="deadline-setting"><span>Transaction deadline</span><span><input max="180" min="1" onChange={(event) => onDeadline(Math.max(1, Number(event.target.value || 20)))} type="number" value={deadlineMinutes}/><b>minutes</b></span></label></div>;
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: "good" | "warning" | "danger" }) {
  return <div className="quote-detail"><span>{label}</span><b className={tone}>{value}</b></div>;
}

function TxStatus({ deployment, notice }: { deployment: BlueDexDeployment; notice?: TxNotice }) {
  if (!notice) return null;
  return <div className={`tx-status ${notice.kind}`}>{notice.kind === "pending" ? <Loader2 className="spin" size={16}/> : notice.kind === "success" ? <Check size={16}/> : <AlertTriangle size={16}/>}<span>{notice.message}</span>{notice.hash ? <a aria-label="View transaction" href={`${deployment.explorer}/tx/${notice.hash}`} rel="noreferrer" target="_blank"><ExternalLink size={15}/></a> : null}</div>;
}

function useTokenBalance(client: PublicClient | undefined, owner: Address | undefined, token: BlueDexToken, deployment: BlueDexDeployment, refreshKey: number) {
  const native = useBalance({ address: owner, chainId: deployment.chainId, query: { enabled: Boolean(owner) && token.native } });
  const [erc20Balance, setErc20Balance] = useState<bigint>();
  useEffect(() => {
    let cancelled = false;
    if (!client || !owner || token.native || token.placeholder) { setErc20Balance(undefined); return; }
    void client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }).then((value) => { if (!cancelled) setErc20Balance(value); }).catch(() => { if (!cancelled) setErc20Balance(0n); });
    return () => { cancelled = true; };
  }, [client, owner, refreshKey, token]);
  return token.native ? native.data?.value : erc20Balance;
}

type WriteContractAsync = ReturnType<typeof useWriteContract>["writeContractAsync"];

async function ensureApproval({ client, owner, token, spender, required, chainId, writeContractAsync, setNotice, lp = false }: { client: PublicClient; owner: Address; token: Address; spender: Address; required: bigint; chainId: 8453 | 4663; writeContractAsync: WriteContractAsync; setNotice: (notice: TxNotice) => void; lp?: boolean }) {
  const allowance = await client.readContract({ address: token, abi: lp ? pairAbi : erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (allowance >= required) return;
  setNotice({ kind: "pending", message: `Approve ${lp ? "LP tokens" : "token"} in your wallet…` });
  const hash = await writeContractAsync({ address: token, abi: lp ? pairAbi : erc20Abi, functionName: "approve", args: [spender, maxUint256], chainId });
  setNotice({ kind: "pending", message: "Approval submitted. Waiting for confirmation…", hash });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Token approval reverted.");
}

async function directReserves(client: PublicClient, deployment: BlueDexDeployment, input: Address, output: Address) {
  const pair = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "getPair", args: [input, output] });
  if (pair === zeroAddress) return undefined;
  const [token0, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
    client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" })
  ]);
  return token0.toLowerCase() === input.toLowerCase() ? { reserveIn: reserves[0], reserveOut: reserves[1] } : { reserveIn: reserves[1], reserveOut: reserves[0] };
}

async function readPoolToken(client: PublicClient, address: Address, tokens: BlueDexToken[]) {
  const known = tokens.find((token) => !token.native && token.address.toLowerCase() === address.toLowerCase());
  if (known) return known;
  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" })
    ]);
    return normalizeImportedToken({ address, name, symbol, decimals, logo: tokenLogoUrl(client.chain?.id || 8453, address) }) || { address, name: "Unknown token", symbol: "?", decimals: 18 };
  } catch {
    return { address, name: "Unknown token", symbol: shortAddress(address), decimals: 18 };
  }
}

function parseTokenAmount(value: string, decimals: number) {
  if (!value || value === ".") return undefined;
  try { return parseUnits(value, decimals); } catch { return undefined; }
}

function sanitizeAmount(value: string) {
  const clean = value.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = clean.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
}

function formatTokenValue(value: bigint, decimals: number, precision: number) {
  const raw = formatUnits(value, decimals);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw;
  if (numeric === 0) return "0";
  if (numeric < 10 ** -precision) return `<${(10 ** -precision).toFixed(precision)}`;
  return numeric.toLocaleString("en-US", { maximumFractionDigits: precision, useGrouping: numeric >= 1_000 });
}

function formatCompactToken(value: bigint, decimals: number) {
  const numeric = Number(formatUnits(value, decimals));
  if (!Number.isFinite(numeric)) return "—";
  if (numeric === 0) return "0";
  if (numeric < 0.0001) return "<0.0001";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: numeric >= 1_000 ? 1 : 4, notation: numeric >= 1_000_000 ? "compact" : "standard" });
}

function formatShare(partsPerMillion: bigint) {
  const value = Number(partsPerMillion) / 10_000;
  if (value === 0) return "0";
  if (value < 0.01) return "<0.01";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatInputValue(value: bigint, decimals: number, precision: number) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, precision).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function formatRate(input: bigint, output: bigint, inputDecimals: number, outputDecimals: number) {
  if (input <= 0n) return "0";
  const scaled = output * 10n ** BigInt(inputDecimals + 8) / input / 10n ** BigInt(outputDecimals);
  return (Number(scaled) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function uniqueTokens(tokens: BlueDexToken[]) {
  const seen = new Set<string>();
  return tokens.filter((token) => { const key = tokenKey(token); if (seen.has(key)) return false; seen.add(key); return true; });
}

function defaultCounterToken(tokens: BlueDexToken[], first: BlueDexToken, deployment: BlueDexDeployment) {
  return tokens.find((token) => !sameToken(token, first, deployment)) || SELECT_TOKEN;
}

function shortError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Unknown error");
  if (/rejected|denied/i.test(raw)) return "Transaction cancelled in wallet.";
  if (/insufficient funds/i.test(raw)) return "Insufficient ETH for the transaction and gas.";
  if (/TRANSFER_FROM_FAILED|transfer amount exceeds/i.test(raw)) return "Token transfer failed. Check balance and approval.";
  if (/INSUFFICIENT_OUTPUT_AMOUNT/i.test(raw)) return "Price moved beyond your slippage setting. Refresh and try again.";
  if (/EXPIRED/i.test(raw)) return "Transaction deadline expired. Try again.";
  const concise = raw.split("\n")[0].replace(/^Error:\s*/i, "");
  return concise.length > 150 ? `${concise.slice(0, 147)}…` : concise;
}
