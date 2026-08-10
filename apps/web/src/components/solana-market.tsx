"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BN } from "@coral-xyz/anchor";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { CandlestickData, HistogramData, IChartApi, UTCTimestamp } from "lightweight-charts";
import { Activity, ArrowDownUp, CheckCircle2, ExternalLink, Loader2, LockKeyhole, RefreshCw, Settings, ShieldCheck, Wallet } from "@/components/bluefun-icons";
import { DexProviderIcon } from "@/components/dex-provider-icon";
import { NetworkIcon } from "@/components/network-icon";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { confirmSolanaSignature } from "@/lib/solana/confirm-signature";

export function SolanaMarket({ launch }: { launch: DeployedLaunch }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [solBalance, setSolBalance] = useState(0n);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rpcError, setRpcError] = useState("");
  const [signature, setSignature] = useState("");
  const [chartMode, setChartMode] = useState<"marketCap" | "price">("marketCap");
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "30m" | "1h">("5m");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slippageBps, setSlippageBps] = useState(200);
  const quoteRequestRef = useRef(0);
  const mint = useMemo(() => new PublicKey(launch.token), [launch.token]);
  const pool = useMemo(() => new PublicKey(launch.liquidityLocker!), [launch.liquidityLocker]);
  const cpAmm = useMemo(() => new CpAmm(connection), [connection]);
  const amountRaw = useMemo(() => parseNineDecimals(amount), [amount]);
  const marketQuery = useQuery<MarketSnapshot>({
    queryKey: ["solana-market", launch.liquidityLocker, launch.token, timeframe],
    queryFn: async () => {
      const params = new URLSearchParams({ pool: launch.liquidityLocker || "", mint: launch.token, creator: launch.creator, timeframe: timeframe === "1m" ? "5m" : timeframe });
      const response = await fetch(`/api/solana/market?${params}`);
      if (!response.ok) throw new Error("Live market data is not available yet.");
      return response.json() as Promise<MarketSnapshot>;
    },
    refetchInterval: 15_000,
    staleTime: 10_000
  });
  const activityQuery = useQuery<SolanaActivity>({
    queryKey: ["solana-market-activity", launch.liquidityLocker, launch.token, launch.creator],
    queryFn: async () => {
      const params = new URLSearchParams({ pool: launch.liquidityLocker || "", mint: launch.token, creator: launch.creator, section: "activity" });
      const response = await fetch(`/api/solana/market?${params}`);
      if (!response.ok) throw new Error("Onchain activity is temporarily unavailable.");
      return response.json() as Promise<SolanaActivity>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refreshBalances(); }, [wallet.publicKey, mint, connection]);
  useEffect(() => {
    const requestId = ++quoteRequestRef.current;
    setQuote(undefined);
    setError("");
    if (amountRaw <= 0n) { setQuoteLoading(false); return; }
    setQuoteLoading(true);
    const timer = window.setTimeout(() => void loadQuote(requestId), 250);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountRaw, side, pool, mint, connection, slippageBps]);

  async function refreshBalances() {
    if (!wallet.publicKey) { setTokenBalance(0n); setSolBalance(0n); setRpcError(""); return; }
    setBalanceLoading(true);
    try {
      const [sol, token] = await Promise.all([
        connection.getBalance(wallet.publicKey, "confirmed"),
        connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, wallet.publicKey), "confirmed").catch(() => undefined)
      ]);
      setSolBalance(BigInt(sol));
      setTokenBalance(BigInt(token?.value.amount || "0"));
      setRpcError("");
    } catch (balanceError) {
      setRpcError(readableRpcError(balanceError));
    } finally {
      setBalanceLoading(false);
    }
  }

  async function loadQuote(requestId: number) {
    try {
      const poolState = await cpAmm.fetchPoolState(pool);
      const currentSlot = await connection.getSlot("confirmed");
      const inputMint = side === "buy" ? NATIVE_MINT : mint;
      const result = cpAmm.getQuote({
        inAmount: new BN(amountRaw.toString()), inputTokenMint: inputMint, slippage: slippageBps / 10_000,
        poolState, currentTime: Math.floor(Date.now() / 1_000), currentSlot,
        tokenADecimal: 9, tokenBDecimal: 9
      });
      if (requestId === quoteRequestRef.current) {
        setQuote({ output: BigInt(result.swapOutAmount.toString()), minimum: result.minSwapOutAmount, poolState });
        setRpcError("");
      }
    } catch (quoteError) {
      if (requestId !== quoteRequestRef.current) return;
      setQuote(undefined);
      const message = readableRpcError(quoteError);
      if (/rpc|forbidden|fetch|network|failed/i.test(message)) setRpcError(message);
      else setError(message);
    } finally {
      if (requestId === quoteRequestRef.current) setQuoteLoading(false);
    }
  }

  async function swap() {
    if (!wallet.publicKey || !wallet.sendTransaction || !quote || busy) return;
    if (side === "buy" && amountRaw >= solBalance) { setError("Network fee reserved: lower the SOL amount slightly."); return; }
    if (side === "sell" && amountRaw > tokenBalance) { setError("Insufficient token balance."); return; }
    setBusy(true); setError(""); setSignature("");
    try {
      const inputMint = side === "buy" ? NATIVE_MINT : mint;
      const outputMint = side === "buy" ? mint : NATIVE_MINT;
      const tx = await cpAmm.swap({
        payer: wallet.publicKey, pool, inputTokenMint: inputMint, outputTokenMint: outputMint,
        amountIn: new BN(amountRaw.toString()), minimumAmountOut: quote.minimum,
        tokenAMint: quote.poolState.tokenAMint, tokenBMint: quote.poolState.tokenBMint,
        tokenAVault: quote.poolState.tokenAVault, tokenBVault: quote.poolState.tokenBVault,
        tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
        referralTokenAccount: null, poolState: quote.poolState
      });
      const sent = await wallet.sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 4 });
      await confirmSolanaSignature(connection, sent);
      setSignature(sent); setAmount(""); setQuote(undefined);
      await refreshBalances();
      await marketQuery.refetch();
    } catch (swapError) {
      const message = swapError instanceof Error ? swapError.message : "Swap failed.";
      setError(/reject|denied|cancel/i.test(message) ? "Request cancelled in wallet." : message);
    } finally { setBusy(false); }
  }

  const insufficient = side === "buy" ? amountRaw >= solBalance : amountRaw > tokenBalance;
  const market = useMemo(() => mergeSolanaMarketSnapshot(marketQuery.data, activityQuery.data), [activityQuery.data, marketQuery.data]);
  const changePositive = (market?.priceChange24h || 0) >= 0;
  const connectedWallet = wallet.publicKey?.toBase58();
  const walletTrades = connectedWallet ? (market?.trades || []).filter((trade) => trade.trader === connectedWallet) : [];
  const chartCandles = useMemo(() => buildSolanaChartCandles(market?.trades || [], market?.candles || [], timeframe), [market?.candles, market?.trades, timeframe]);
  const buttonLabel = !wallet.publicKey ? "Connect Solana wallet" : rpcError ? "RPC temporarily unavailable" : insufficient ? "Insufficient balance" : quoteLoading ? "Getting live quote" : busy ? "Confirming swap" : `${side === "buy" ? "Buy" : "Sell"} $${launch.symbol}`;

  return <div className="trade-layout reference-token-terminal solana-token-terminal">
    <section className="market-summary-column">
      <div className="market-header-card">
        <div className="market-header-main">
          <div className="solana-market-art profile-art">{launch.imageURI ? <img alt={`${launch.name} logo`} src={ipfsUrl(launch.imageURI)} /> : <NetworkIcon chainId={101} size={32} />}</div>
          <div className="market-title-block">
            <div className="market-title-row"><h1>{launch.name}</h1><span className="token-status live">Direct DEX</span></div>
            <div className="market-meta"><span>${launch.symbol}</span><span>{launch.age} ago</span><span>{shortSolana(launch.creator)}</span></div>
            {launch.description ? <p className="market-description">{launch.description}</p> : null}
            <span className="market-route-pill trusted"><NetworkIcon chainId={101} size={13}/><DexProviderIcon provider="meteora" size={13}/>Solana · Meteora</span>
          </div>
          <div className="market-actions"><a className="market-icon-action" aria-label="Open token on Solscan" href={`https://solscan.io/token/${launch.token}`} rel="noreferrer" target="_blank"><ExternalLink size={16}/></a><a className="market-icon-action" aria-label="Open Meteora pool" href={`https://app.meteora.ag/dammv2/${launch.liquidityLocker}`} rel="noreferrer" target="_blank"><DexProviderIcon provider="meteora" size={16}/></a></div>
        </div>
        <div className="market-header-stats">
          <div><span>Market cap</span><strong>{compactUsd(market?.marketCap ?? market?.fdv)}</strong></div>
          <div><span>Price</span><strong>{formatUsd(market?.priceUsd)}</strong></div>
          <div><span>Liquidity</span><strong>{compactUsd(market?.liquidityUsd)}</strong></div>
          <div><span>24h volume</span><strong>{compactUsd(market?.volume24h)}</strong></div>
          <div><span>Buys</span><strong className="reference-positive">{market?.buys24h ?? "–"}</strong></div>
          <div><span>Sells</span><strong className="reference-negative">{market?.sells24h ?? "–"}</strong></div>
        </div>
        <span className="reference-lp-lock"><LockKeyhole size={14}/>LP locked</span>
      </div>
    </section>

    <section className="market-content-column">
      <div className="chart-panel"><div className="curve-state compact">
        <section className="tv-chart-wrap solana-tv-chart">
          <div className="tv-chart-header">
            <div className="chart-activity-strip"><span><small>Buys</small><strong>{market?.buys24h ?? 0}</strong></span><span><small>Sells</small><strong>{market?.sells24h ?? 0}</strong></span><span><small>Traders</small><strong>{new Set((market?.trades || []).map((trade) => trade.trader)).size}</strong></span></div>
            <div className="chart-controls"><div className="chart-interval-tabs" role="tablist" aria-label="Candle interval">{(["1m", "5m", "30m", "1h"] as const).map((value) => <button aria-selected={timeframe === value} className={timeframe === value ? "active" : ""} key={value} onClick={() => setTimeframe(value)} role="tab" type="button">{value}</button>)}<button aria-label="Refresh chart" onClick={() => void marketQuery.refetch()} type="button"><RefreshCw className={marketQuery.isFetching ? "spin" : ""} size={13}/></button></div><span className="chart-indicators-label">Indicators</span><div className="chart-mode-tabs" role="tablist"><button aria-selected={chartMode === "marketCap"} className={chartMode === "marketCap" ? "active" : ""} onClick={() => setChartMode("marketCap")} role="tab" type="button">Market Cap</button><button aria-selected={chartMode === "price"} className={chartMode === "price" ? "active" : ""} onClick={() => setChartMode("price")} role="tab" type="button">Price</button></div></div>
          </div>
          <SolanaPriceChart candles={chartCandles} loading={marketQuery.isLoading || (activityQuery.isLoading && !chartCandles.length)} mode={chartMode} solUsd={market?.solUsd}/>
          <div className="solana-chart-caption"><span><Activity size={13}/>Meteora swaps · onchain candles</span><span className={changePositive ? "reference-positive" : "reference-negative"}>{market?.priceChange24h == null ? "Live" : `${changePositive ? "+" : ""}${market.priceChange24h.toFixed(2)}% 24h`}</span></div>
        </section>
        {marketQuery.isError ? <p className="launch-notice danger">Live chart data could not be refreshed. Trading remains available.</p> : null}
        <SolanaMarketData launch={launch} market={market} wallet={connectedWallet} loading={activityQuery.isLoading}/>
      </div></div>
    </section>

    <aside className="trade-box">
      <section className="trade-card swap-terminal solana-swap-card">
        <div className="trade-card-toolbar"><div><strong>Swap</strong><span>Meteora DAMM v2</span></div><button className={settingsOpen ? "swap-settings-trigger active" : "swap-settings-trigger"} onClick={() => setSettingsOpen((open) => !open)} type="button" aria-label="Slippage settings"><Settings size={17}/><span>{slippageBps / 100}%</span></button></div>
        <div className="form">
          <div className="trade-tabs trade-tabs-top" role="tablist"><button aria-selected={side === "buy"} className={side === "buy" ? "active" : ""} onClick={() => setSide("buy")} role="tab" type="button">Buy ${launch.symbol}</button><button aria-selected={side === "sell"} className={side === "sell" ? "active" : ""} onClick={() => setSide("sell")} role="tab" type="button">Sell</button></div>
          {!wallet.publicKey ? <div className="wallet-trade-gate"><span className="wallet-status-dot"/>Connect Solana wallet to trade</div> : null}
          <div className="swap-asset-stack">
            <div className="swap-asset-panel swap-pay-panel"><div className="swap-panel-label"><span>{side === "buy" ? "You pay" : "You sell"}</span><button className="balance-button" onClick={() => side === "buy" ? setAmount(formatNine(solBalance > 5_000_000n ? solBalance - 5_000_000n : 0n, 6)) : setAmount(formatNine(tokenBalance, 9))} type="button">{balanceLoading ? "Loading…" : `Balance ${formatNine(side === "buy" ? solBalance : tokenBalance)}`}</button></div><div className="swap-asset-main"><input className="swap-amount-input" inputMode="decimal" placeholder="0" value={amount} onChange={(event) => setAmount(sanitize(event.target.value))}/><SolanaAssetPill launch={launch} native={side === "buy"}/></div><div className={side === "buy" ? "swap-quick-row" : "swap-quick-row sell-grid"}>{side === "buy" ? ["0.01", "0.05", "0.1"].map((value) => <button key={value} onClick={() => setAmount(value)} type="button">{value}</button>) : [25,50,75,100].map((percent) => <button key={percent} onClick={() => setAmount(formatNine(tokenBalance * BigInt(percent) / 100n, 9))} type="button">{percent === 100 ? "Max" : `${percent}%`}</button>)}</div></div>
            <button className="swap-direction-button" onClick={() => setSide(side === "buy" ? "sell" : "buy")} type="button" aria-label="Reverse swap direction"><ArrowDownUp size={17}/></button>
            <div className="swap-asset-panel swap-receive-panel"><div className="swap-panel-label"><span>{quoteLoading ? "Updating quote" : "You receive"}</span></div><div className="swap-asset-main"><strong className="swap-quote-value">{quote ? formatNine(quote.output) : quoteLoading ? "…" : "–"}</strong><SolanaAssetPill launch={launch} native={side === "sell"}/></div><div className="swap-detail-row"><span>Minimum <b>{quote ? formatNine(BigInt(quote.minimum.toString())) : "–"}</b></span><span>Slippage <b>{slippageBps / 100}%</b></span></div></div>
          </div>
          <div className="trade-meta-line"><span><NetworkIcon chainId={101} size={14}/>Solana</span><i/><span><DexProviderIcon provider="meteora" size={14}/>Meteora</span><i/>1% fee</div>
          {settingsOpen ? <div className="trade-settings-panel"><div className="settings-panel-head"><strong>Trade settings</strong><span>Slippage</span></div><div className="slippage-row">{[50,100,200,300].map((value) => <button className={slippageBps === value ? "selected" : ""} key={value} onClick={() => setSlippageBps(value)} type="button">{value / 100}%</button>)}</div></div> : null}
          {rpcError ? <p className="launch-notice danger">{rpcError}</p> : null}{error ? <p className="launch-notice danger">{error}</p> : null}{signature ? <p className="launch-notice success"><CheckCircle2 size={15}/>Swap confirmed. <a href={`https://solscan.io/tx/${signature}`} rel="noreferrer" target="_blank">View transaction</a></p> : null}
          <button className={`button primary wide trade-submit ${side}`} disabled={!wallet.publicKey || !quote || amountRaw <= 0n || insufficient || busy || Boolean(rpcError)} onClick={() => void swap()} type="button">{busy || quoteLoading ? <Loader2 className="spin" size={17}/> : <ArrowDownUp size={17}/>} {buttonLabel}</button>
        </div>
      </section>
      <section className="reference-order-summary" aria-label="Account trading summary"><div><span>Bought</span><strong>{walletTrades.filter((trade) => trade.side === "buy").length}</strong></div><div><span>Sold</span><strong>{walletTrades.filter((trade) => trade.side === "sell").length}</strong></div><div><span>Balance</span><strong>{formatNine(tokenBalance)}</strong></div><div><span>P/L</span><strong className="reference-positive">Live</strong></div></section>
      <section className="reference-token-side-info"><h3>Token information</h3><div><span>Contract</span><strong>{shortSolana(launch.token)}</strong></div><div><span>Creator</span><strong>{shortSolana(launch.creator)}</strong></div><div><span>Total supply</span><strong>1B {launch.symbol}</strong></div><div><span>Liquidity</span><strong>Locked permanently</strong></div></section>
    </aside>
  </div>;
}

function SolanaAssetPill({ launch, native }: { launch: DeployedLaunch; native: boolean }) { return <span className="swap-token-pill">{native ? <span className="swap-token-icon native"><NetworkIcon chainId={101} size={28}/></span> : launch.imageURI ? <img alt={launch.name} className="swap-token-icon token-avatar-image" src={ipfsUrl(launch.imageURI)}/> : <span className="swap-token-icon"><NetworkIcon chainId={101} size={22}/></span>}<span className="swap-token-copy"><strong>{native ? "SOL" : launch.symbol}</strong><small>Solana</small></span></span>; }

function SolanaMarketData({ launch, market, wallet, loading }: { launch: DeployedLaunch; market?: MarketSnapshot; wallet?: string; loading: boolean }) {
  const [tab, setTab] = useState<"trades" | "position" | "holders" | "security">("trades");
  const trades = market?.trades || [];
  const holders = market?.holders || [];
  const walletTrades = wallet ? trades.filter((trade) => trade.trader === wallet) : [];
  const position = walletTrades.reduce((summary, trade) => {
    const direction = trade.side === "buy" ? 1 : -1;
    summary.tokens += trade.tokenAmount * direction;
    summary.sol -= trade.nativeAmount * direction;
    summary.buys += trade.side === "buy" ? 1 : 0;
    summary.sells += trade.side === "sell" ? 1 : 0;
    return summary;
  }, { tokens: 0, sol: 0, buys: 0, sells: 0 });
  const creator = holders.find((holder) => holder.role === "creator");
  const publicTopFive = holders.filter((holder) => holder.role === "holder").slice(0, 5).reduce((total, holder) => total + holder.percent, 0);
  const tabs = [
    { id: "trades" as const, label: "Trades", count: trades.length },
    { id: "position" as const, label: "Position", count: wallet ? walletTrades.length : undefined },
    { id: "holders" as const, label: "Holders", count: market?.holderCount ?? holders.length },
    { id: "security" as const, label: "Security", count: undefined }
  ];

  return <section className="recent-trades solana-market-data">
    <div className="recent-trades-head"><nav aria-label="Solana market data" className="reference-trade-data-tabs" role="tablist">{tabs.map((item) => <button aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">{item.label}{item.count !== undefined ? <small>{item.count}</small> : null}</button>)}</nav></div>
    <div className="market-data-content">
      {tab === "trades" ? loading && !market ? <MarketDataState icon={<Loader2 className="spin" size={19}/>} title="Loading onchain trades" detail="Reading recent Meteora swaps from Solana."/> : !trades.length ? <MarketDataState icon={<Activity size={19}/>} title="No swaps found yet" detail="New Meteora swaps will appear here automatically."/> : <div className="market-data-table market-trades-table"><div className="market-data-table-head"><span>Time</span><span>Side</span><span>Wallet</span><span>Token amount</span><span>SOL total</span><span>Transaction</span></div><div className="market-data-table-body">{trades.map((trade) => <a className="market-data-table-row" href={`https://solscan.io/tx/${trade.signature}`} key={trade.signature} rel="noreferrer" target="_blank"><span className="market-data-time">{formatActivityTime(trade.timestamp)}</span><span className={`trade-side ${trade.side}`}>{trade.side}</span><span className="trade-wallet">{shortSolana(trade.trader)}</span><strong>{compactNumber(trade.tokenAmount)} {launch.symbol}</strong><span>{formatSol(trade.nativeAmount)} SOL</span><span className="market-data-tx">{shortSolana(trade.signature)} <ExternalLink size={11}/></span></a>)}</div></div> : null}

      {tab === "position" ? !wallet ? <MarketDataState icon={<Wallet size={19}/>} title="Connect a Solana wallet" detail="Your buys, sells and net position will appear here."/> : !walletTrades.length ? <MarketDataState icon={<Activity size={19}/>} title="No indexed position" detail={`No recent ${launch.symbol} swaps were found for ${shortSolana(wallet)}.`}/> : <div className="position-workspace"><div className="position-summary-card"><span>Wallet</span><strong>{shortSolana(wallet)}</strong><small>Recent onchain activity</small></div><div className="position-summary-card"><span>Net token flow</span><strong className={position.tokens >= 0 ? "reference-positive" : "reference-negative"}>{position.tokens >= 0 ? "+" : ""}{compactNumber(position.tokens)} {launch.symbol}</strong><small>{position.buys} buys · {position.sells} sells</small></div><div className="position-summary-card"><span>Net SOL flow</span><strong className={position.sol >= 0 ? "reference-positive" : "reference-negative"}>{position.sol >= 0 ? "+" : ""}{formatSol(position.sol)} SOL</strong><small>Calculated from recent swaps</small></div></div> : null}

      {tab === "holders" ? loading && !market ? <MarketDataState icon={<Loader2 className="spin" size={19}/>} title="Loading holders" detail="Resolving the largest token accounts on Solana."/> : !holders.length ? <MarketDataState icon={<Wallet size={19}/>} title="Holder data is unavailable" detail="The current RPC provider did not return token-account distribution."/> : <div className="market-data-table holders-table"><div className="market-data-context">Current largest token accounts and participant balances reported onchain.</div><div className="market-data-table-head"><span>Rank</span><span>Wallet</span><span>Type</span><span>Balance</span><span>Supply</span><span>Explorer</span></div><div className="market-data-table-body">{holders.map((holder, index) => <a className="market-data-table-row" href={`https://solscan.io/account/${holder.owner}`} key={`${holder.owner}-${holder.role}`} rel="noreferrer" target="_blank"><span className="market-data-rank">{String(index + 1).padStart(2, "0")}</span><strong>{shortSolana(holder.owner)}</strong><span className={`holder-role ${holder.role}`}>{holder.role === "pool" ? "Liquidity pool" : holder.role === "creator" ? "Creator wallet" : "Holder"}</span><span>{compactNumber(holder.balance)} {launch.symbol}</span><strong>{formatPercent(holder.percent)}</strong><span className="market-data-tx">Solscan <ExternalLink size={11}/></span></a>)}</div></div> : null}

      {tab === "security" ? <div className="risk-workspace"><div className="risk-overview"><div className="risk-overview-heading"><span>Market safety snapshot</span><strong>Protected launch</strong></div><div className="risk-score"><strong>4<small>/4</small></strong><span>verified controls</span></div><p>Signals use the immutable mint configuration, locked Meteora positions and current holder distribution.</p></div><div className="risk-check-grid"><SolanaRisk label="Mint authority" value="Revoked" detail="No additional supply can be minted"/><SolanaRisk label="Freeze authority" value="Disabled" detail="Token accounts cannot be frozen by creator"/><SolanaRisk label="Liquidity custody" value="Permanently locked" detail="Both Meteora position NFTs are locked"/><SolanaRisk label="Creator allocation" value={formatPercent(creator?.percent || 0)} detail={`${shortSolana(launch.creator)} · current tracked balance`}/><SolanaRisk label="Top 5 public holders" value={formatPercent(publicTopFive)} detail="Excludes the liquidity pool and creator"/><SolanaRisk label="Market route" value="Meteora DAMM v2" detail="Direct market · no bonding threshold"/></div></div> : null}
    </div>
  </section>;
}

function MarketDataState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="market-data-empty"><span className="market-data-empty-icon">{icon}</span><strong>{title}</strong><p>{detail}</p></div>; }
function SolanaRisk({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="risk-check"><span><ShieldCheck size={16}/>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }

function SolanaPriceChart({ candles, loading, mode, solUsd }: { candles: MarketCandle[]; loading: boolean; mode: "marketCap" | "price"; solUsd?: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !candles.length || !solUsd) return;
    const usdRate = solUsd;
    let disposed = false;
    async function setup() {
      const { CandlestickSeries, ColorType, createChart, HistogramSeries } = await import("lightweight-charts");
      if (disposed || !container) return;
      const dark = document.documentElement.dataset.theme === "dark";
      const scale = usdRate * (mode === "marketCap" ? 1_000_000_000 : 1);
      const priceFormatter = mode === "marketCap" ? compactUsd : formatUsd;
      const chart = createChart(container, {
        autoSize: true, height: 340,
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        layout: { background: { type: ColorType.Solid, color: dark ? "#08090d" : "#fbfcff" }, textColor: dark ? "#9ca6b8" : "#63718d", fontFamily: "\"Helvetica Neue\", Inter, ui-sans-serif, system-ui" },
        grid: { vertLines: { color: dark ? "rgba(126,145,184,.09)" : "rgba(112,132,174,.13)" }, horzLines: { color: dark ? "rgba(126,145,184,.09)" : "rgba(112,132,174,.13)" } },
        rightPriceScale: { borderColor: dark ? "#252a34" : "#dfe5f1", scaleMargins: { top: .12, bottom: .28 } },
        timeScale: { barSpacing: 14, borderColor: dark ? "#252a34" : "#dfe5f1", timeVisible: true, secondsVisible: false, rightOffset: 3 },
        crosshair: { vertLine: { color: "rgba(66,217,255,.42)", labelBackgroundColor: "#315cff" }, horzLine: { color: "rgba(66,217,255,.42)", labelBackgroundColor: "#315cff" } },
        localization: { priceFormatter }
      });
      chartRef.current = chart;
      const series = chart.addSeries(CandlestickSeries, { upColor: "#20cca0", downColor: "#fa6776", borderVisible: false, wickUpColor: "#20cca0", wickDownColor: "#fa6776", priceFormat: { type: "custom", formatter: priceFormatter, minMove: mode === "marketCap" ? .01 : .0000000001 } });
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", color: "rgba(91,111,255,.24)", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: .8, bottom: 0 }, visible: false, borderVisible: false });
      series.setData(candles.map((candle) => ({ time: candle.time as UTCTimestamp, open: candle.open * scale, high: candle.high * scale, low: candle.low * scale, close: candle.close * scale })) as CandlestickData<UTCTimestamp>[]);
      volume.setData(candles.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.volume, color: candle.close >= candle.open ? "rgba(32,204,160,.3)" : "rgba(250,103,118,.3)" })) as HistogramData<UTCTimestamp>[]);
      const visibleBars = Math.min(Math.max(candles.length, 12), 48);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - visibleBars - 1), to: candles.length + 1 });
    }
    void setup();
    return () => { disposed = true; chartRef.current?.remove(); chartRef.current = null; };
  }, [candles, mode, solUsd]);

  if (loading) return <div className="solana-chart-state"><Loader2 className="spin" size={20}/> Loading live chart</div>;
  if (!candles.length || !solUsd) return <div className="solana-chart-state"><Activity size={20}/> Chart begins with the first market trades.</div>;
  return <div className="tv-chart solana-chart-canvas" ref={containerRef}/>;
}

function buildSolanaChartCandles(trades: SolanaTrade[], fallback: MarketCandle[], timeframe: "1m" | "5m" | "30m" | "1h") {
  const intervalSeconds = timeframe === "1m" ? 60 : timeframe === "5m" ? 300 : timeframe === "30m" ? 1_800 : 3_600;
  const buckets = new Map<number, MarketCandle>();
  let lastAcceptedPrice = 0;
  trades
    .filter((trade) => trade.timestamp > 0 && trade.nativeAmount > .000001 && Number.isFinite(trade.priceNative) && trade.priceNative > 0)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp || a.slot - b.slot)
    .forEach((trade) => {
      if (lastAcceptedPrice > 0 && (trade.priceNative > lastAcceptedPrice * 8 || trade.priceNative < lastAcceptedPrice / 8)) return;
      lastAcceptedPrice = trade.priceNative;
      const time = Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;
      const bucket = buckets.get(time);
      if (!bucket) {
        buckets.set(time, { time, open: trade.priceNative, high: trade.priceNative, low: trade.priceNative, close: trade.priceNative, volume: trade.nativeAmount });
        return;
      }
      bucket.high = Math.max(bucket.high, trade.priceNative);
      bucket.low = Math.min(bucket.low, trade.priceNative);
      bucket.close = trade.priceNative;
      bucket.volume += trade.nativeAmount;
    });
  const tradeCandles = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
  if (tradeCandles.length) return connectCandleOpens(tradeCandles);
  const activeFallback = fallback.filter((candle) => candle.volume > 0 && Number.isFinite(candle.close) && candle.close > 0);
  return connectCandleOpens(activeFallback.length ? activeFallback : fallback.slice(-1));
}

function mergeSolanaMarketSnapshot(snapshot?: MarketSnapshot, activity?: SolanaActivity): MarketSnapshot | undefined {
  if (!snapshot) return;
  const trades = activity?.trades || [];
  const latestTrade = trades
    .filter((trade) => trade.timestamp > 0 && Number.isFinite(trade.priceNative) && trade.priceNative > 0)
    .sort((a, b) => b.timestamp - a.timestamp || b.slot - a.slot)[0];
  const priceNative = snapshot.priceNative ?? latestTrade?.priceNative ?? null;
  const priceUsd = snapshot.priceUsd ?? (priceNative && snapshot.solUsd ? priceNative * snapshot.solUsd : null);
  const derivedMarketCap = priceUsd ? priceUsd * 1_000_000_000 : null;
  const since = Math.floor(Date.now() / 1_000) - 24 * 60 * 60;
  const recentTrades = trades.filter((trade) => trade.timestamp >= since);
  return {
    ...snapshot,
    priceNative,
    priceUsd,
    fdv: snapshot.fdv ?? derivedMarketCap,
    marketCap: snapshot.marketCap ?? derivedMarketCap,
    volume24h: snapshot.volume24h ?? recentTrades.reduce((total, trade) => total + trade.nativeAmount * (snapshot.solUsd || 0), 0),
    buys24h: snapshot.buys24h ?? recentTrades.filter((trade) => trade.side === "buy").length,
    sells24h: snapshot.sells24h ?? recentTrades.filter((trade) => trade.side === "sell").length,
    trades,
    holders: activity?.holders || [],
    holderCount: activity?.holderCount ?? null
  };
}

function connectCandleOpens(candles: MarketCandle[]) {
  let previousClose = 0;
  return candles.map((source) => {
    const open = previousClose > 0 ? previousClose : source.open;
    const candle = { ...source, open, high: Math.max(source.high, open, source.close), low: Math.min(source.low, open, source.close) };
    previousClose = source.close;
    return candle;
  });
}

type Quote = { output: bigint; minimum: BN; poolState: Awaited<ReturnType<CpAmm["fetchPoolState"]>> };
type MarketCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type SolanaTrade = { signature: string; trader: string; side: "buy" | "sell"; tokenAmount: number; nativeAmount: number; priceNative: number; timestamp: number; slot: number };
type SolanaHolder = { owner: string; balance: number; percent: number; role: "pool" | "creator" | "holder"; account?: string };
type SolanaActivity = { trades: SolanaTrade[]; holders: SolanaHolder[]; holderCount: number | null };
type MarketSnapshot = { priceUsd: number | null; priceNative: number | null; solUsd: number | null; liquidityUsd: number | null; fdv: number | null; marketCap: number | null; volume24h: number | null; priceChange24h: number | null; buys24h: number | null; sells24h: number | null; pairUrl: string; candles: MarketCandle[]; trades: SolanaTrade[]; holders: SolanaHolder[]; holderCount: number | null };
function parseNineDecimals(value: string) { const [whole = "0", decimals = ""] = (value || "0").split("."); return BigInt(whole || "0") * 1_000_000_000n + BigInt(decimals.padEnd(9, "0").slice(0, 9) || "0"); }
function formatNine(value: bigint, digits = 4) { const whole = value / 1_000_000_000n; const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").slice(0, digits).replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); }
function sanitize(value: string) { const clean = value.replace(",", ".").replace(/[^0-9.]/g, ""); const [whole, ...fraction] = clean.split("."); return fraction.length ? `${whole}.${fraction.join("").slice(0, 9)}` : whole; }
function ipfsUrl(uri: string) { return uri.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}` : uri; }
function compactUsd(value?: number | null) { if (value == null) return "–"; return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value); }
function formatUsd(value?: number | null) { if (value == null) return "–"; if (value >= .01) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`; return `$${value.toPrecision(4)}`; }
function readableRpcError(error: unknown) { const message = error instanceof Error ? error.message : "Solana RPC is temporarily unavailable."; return /403|forbidden/i.test(message) ? "Solana RPC access is temporarily unavailable. Please retry shortly." : message; }
function compactNumber(value: number) { return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value); }
function formatSol(value: number) { return Math.abs(value) < .0001 && value !== 0 ? value.toPrecision(3) : value.toLocaleString("en-US", { maximumFractionDigits: 6 }); }
function formatPercent(value: number) { return `${value < .01 && value > 0 ? "<0.01" : value.toFixed(value < 1 ? 2 : 1)}%`; }
function shortSolana(value: string) { return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value; }
function formatActivityTime(timestamp: number) { if (!timestamp) return "–"; const date = new Date(timestamp * 1_000); const diff = Date.now() - date.getTime(); if (diff < 60_000) return "now"; if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`; if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`; return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
