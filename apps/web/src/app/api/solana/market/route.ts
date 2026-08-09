import { NextRequest, NextResponse } from "next/server";

export const revalidate = 15;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WSOL = "So11111111111111111111111111111111111111112";
const activityCache = new Map<string, { expiresAt: number; value: SolanaActivity }>();

type DexPair = {
  priceUsd?: string; priceNative?: string; liquidity?: { usd?: number }; fdv?: number; marketCap?: number;
  volume?: { h24?: number }; priceChange?: { h24?: number }; txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number; url?: string;
};
type MeteoraCandle = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
type MeteoraToken = { address?: string; decimals?: number; holders?: number; total_supply?: number };
type MeteoraPool = { token_x?: MeteoraToken; token_y?: MeteoraToken; token_x_amount?: number; token_y_amount?: number; vault_x?: string; vault_y?: string };
type SignatureInfo = { signature: string; slot: number; blockTime?: number | null; err?: unknown };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount?: { amount?: string; decimals?: number } };
type ParsedTransaction = {
  blockTime?: number | null;
  meta?: { err?: unknown; fee?: number; preBalances?: number[]; postBalances?: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string; signer?: boolean }> } };
};
type SolanaTrade = { signature: string; trader: string; side: "buy" | "sell"; tokenAmount: number; nativeAmount: number; priceNative: number; timestamp: number; slot: number };
type SolanaHolder = { owner: string; balance: number; percent: number; role: "pool" | "creator" | "holder"; account?: string };
type SolanaActivity = { trades: SolanaTrade[]; holders: SolanaHolder[]; holderCount: number | null };

export async function GET(request: NextRequest) {
  const pool = request.nextUrl.searchParams.get("pool")?.trim() || "";
  const mint = request.nextUrl.searchParams.get("mint")?.trim() || "";
  const creator = request.nextUrl.searchParams.get("creator")?.trim() || "";
  const requestedTimeframe = request.nextUrl.searchParams.get("timeframe") || "5m";
  const timeframe = requestedTimeframe === "30m" || requestedTimeframe === "1h" ? requestedTimeframe : "5m";
  if (!SOLANA_ADDRESS.test(pool) || !SOLANA_ADDRESS.test(mint) || (creator && !SOLANA_ADDRESS.test(creator))) return NextResponse.json({ error: "Invalid Solana market." }, { status: 400 });

  if (request.nextUrl.searchParams.get("section") === "activity") {
    const poolPayload = await fetch(`https://damm-v2.datapi.meteora.ag/pools/${pool}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5_000) })
      .then(assertOk)
      .then((response) => response.json() as Promise<MeteoraPool>)
      .catch(() => undefined);
    const tokenIsX = poolPayload?.token_x?.address === mint;
    const tokenInfo = tokenIsX ? poolPayload?.token_x : poolPayload?.token_y;
    const poolTokenBalance = numberOrNull(tokenIsX ? poolPayload?.token_x_amount : poolPayload?.token_y_amount);
    const poolTokenVault = tokenIsX ? poolPayload?.vault_x : poolPayload?.vault_y;
    const totalSupply = numberOrNull(tokenInfo?.total_supply) || 1_000_000_000;
    const activity = await getSolanaActivity({ pool, mint, creator, poolTokenVault, poolTokenBalance, totalSupply, holderCount: numberOrNull(tokenInfo?.holders) })
      .catch(() => ({ trades: [], holders: poolTokenBalance == null ? [] : [{ owner: pool, balance: poolTokenBalance, percent: poolTokenBalance / totalSupply * 100, role: "pool" as const, account: poolTokenVault }], holderCount: numberOrNull(tokenInfo?.holders) }));
    return NextResponse.json(activity, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } });
  }

  const now = Math.floor(Date.now() / 1_000);
  const range = timeframe === "5m" ? 6 * 60 * 60 : timeframe === "30m" ? 24 * 60 * 60 : 48 * 60 * 60;
  const start = now - range;
  const [dexResult, candleResult] = await Promise.allSettled([
    fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pool}`, { next: { revalidate: 15 }, signal: AbortSignal.timeout(8_000) }).then(assertOk).then((response) => response.json()),
    fetchMeteoraCandles(pool, timeframe, start, now)
  ]);

  const dexPayload = dexResult.status === "fulfilled" ? dexResult.value as { pair?: DexPair; pairs?: DexPair[] } : undefined;
  const pair = dexPayload?.pair || dexPayload?.pairs?.[0];
  let candlePayload = candleResult.status === "fulfilled" ? candleResult.value : undefined;
  if (!candlePayload?.data?.length && pair?.pairCreatedAt) {
    const createdAt = Math.floor(pair.pairCreatedAt / 1_000);
    candlePayload = await fetchMeteoraCandles(pool, timeframe, createdAt - 300, Math.min(now, createdAt + range)).catch(() => candlePayload);
  }
  if (!pair && !candlePayload?.data?.length) return NextResponse.json({ error: "Market data is not available yet." }, { status: 502 });

  const candles = (candlePayload?.data || []).filter(validCandle).map((candle) => ({ time: candle.timestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }));
  const priceNative = numberOrNull(pair?.priceNative) ?? candles.at(-1)?.close ?? null;
  const priceUsd = numberOrNull(pair?.priceUsd);

  return NextResponse.json({
    priceUsd, priceNative, solUsd: priceUsd && priceNative ? priceUsd / priceNative : null,
    liquidityUsd: numberOrNull(pair?.liquidity?.usd), fdv: numberOrNull(pair?.fdv), marketCap: numberOrNull(pair?.marketCap),
    volume24h: numberOrNull(pair?.volume?.h24), priceChange24h: numberOrNull(pair?.priceChange?.h24),
    buys24h: numberOrNull(pair?.txns?.h24?.buys), sells24h: numberOrNull(pair?.txns?.h24?.sells),
    pairCreatedAt: numberOrNull(pair?.pairCreatedAt), pairUrl: pair?.url || `https://dexscreener.com/solana/${pool}`,
    timeframe, candles
  }, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=45" } });
}

async function getSolanaActivity(input: { pool: string; mint: string; creator: string; poolTokenVault?: string; poolTokenBalance: number | null; totalSupply: number; holderCount: number | null }) {
  const cacheKey = `${input.pool}:${input.mint}:${input.creator}`;
  const cached = activityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const [signatureResult, largestResult] = await Promise.allSettled([
    rpcCall<SignatureInfo[]>(rpcUrl, "getSignaturesForAddress", [input.pool, { limit: 24, commitment: "confirmed" }]),
    rpcCall<{ value?: Array<{ address: string; amount: string; decimals: number; uiAmount?: number }> }>(rpcUrl, "getTokenLargestAccounts", [input.mint, { commitment: "confirmed" }])
  ]);
  const signatures = signatureResult.status === "fulfilled" ? signatureResult.value.filter((entry) => !entry.err).slice(0, 20) : [];
  const transactions = signatures.length ? await rpcBatch<ParsedTransaction | null>(rpcUrl, signatures.map((entry) => ({ method: "getTransaction", params: [entry.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }] }))).catch(() => []) : [];
  const trades = signatures.map((signature, index) => parseTrade(signature, transactions[index], input.mint)).filter((trade): trade is SolanaTrade => Boolean(trade));
  const latestBalances = new Map<string, number>();
  for (let index = 0; index < signatures.length; index += 1) collectLatestTraderBalance(transactions[index], input.mint, latestBalances);

  const largest = largestResult.status === "fulfilled" ? largestResult.value.value || [] : [];
  const largestOwners = largest.length ? await resolveTokenAccountOwners(rpcUrl, largest.map((row) => row.address)).catch(() => []) : [];
  const holdersByOwner = new Map<string, SolanaHolder>();
  largest.forEach((row, index) => {
    const owner = largestOwners[index];
    const balance = Number(row.amount) / 10 ** row.decimals;
    if (!owner || !Number.isFinite(balance) || balance <= 0 || row.address === input.poolTokenVault) return;
    const role = owner === input.creator ? "creator" : "holder";
    const existing = holdersByOwner.get(owner);
    if (!existing || balance > existing.balance) holdersByOwner.set(owner, { owner, balance, percent: balance / input.totalSupply * 100, role, account: row.address });
  });
  for (const [owner, balance] of latestBalances) if (!holdersByOwner.has(owner) && balance > 0) holdersByOwner.set(owner, { owner, balance, percent: balance / input.totalSupply * 100, role: owner === input.creator ? "creator" : "holder" });
  if (input.poolTokenBalance != null) holdersByOwner.set(input.pool, { owner: input.pool, balance: input.poolTokenBalance, percent: input.poolTokenBalance / input.totalSupply * 100, role: "pool", account: input.poolTokenVault });
  const holders = Array.from(holdersByOwner.values()).sort((a, b) => b.balance - a.balance).slice(0, 20);
  const value = { trades, holders, holderCount: input.holderCount };
  if (activityCache.size > 1_000) activityCache.clear();
  activityCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value });
  return value;
}

function parseTrade(signature: SignatureInfo, transaction: ParsedTransaction | null | undefined, mint: string): SolanaTrade | undefined {
  if (!transaction?.meta || transaction.meta.err) return;
  const keys = transaction.transaction?.message?.accountKeys || [];
  const signer = keys.find((key): key is { pubkey?: string; signer?: boolean } => typeof key !== "string" && Boolean(key.signer));
  const firstKey = keys[0];
  const trader = signer?.pubkey || (typeof firstKey === "string" ? firstKey : firstKey?.pubkey);
  if (!trader) return;
  const tokenDelta = ownerTokenDelta(transaction.meta.preTokenBalances, transaction.meta.postTokenBalances, mint, trader);
  if (tokenDelta === 0n) return;
  const nativeDelta = largestMintDelta(transaction.meta.preTokenBalances, transaction.meta.postTokenBalances, WSOL);
  if (nativeDelta === 0n) return;
  const tokenAmount = Number(abs(tokenDelta)) / 1e9;
  const nativeAmount = Number(abs(nativeDelta)) / 1e9;
  // Pool initialization and account-closing transfers can look like swaps at
  // one-lamport scale. They are not user market activity and distort candles.
  if (!Number.isFinite(tokenAmount) || !Number.isFinite(nativeAmount) || tokenAmount <= 0 || nativeAmount <= 0.000001) return;
  return { signature: signature.signature, trader, side: tokenDelta > 0n ? "buy" : "sell", tokenAmount, nativeAmount, priceNative: nativeAmount / tokenAmount, timestamp: transaction.blockTime || signature.blockTime || 0, slot: signature.slot };
}

function collectLatestTraderBalance(transaction: ParsedTransaction | null | undefined, mint: string, balances: Map<string, number>) {
  const keys = transaction?.transaction?.message?.accountKeys || [];
  const signer = keys.find((key): key is { pubkey?: string; signer?: boolean } => typeof key !== "string" && Boolean(key.signer));
  const firstKey = keys[0];
  const trader = signer?.pubkey || (typeof firstKey === "string" ? firstKey : firstKey?.pubkey);
  if (!trader || balances.has(trader)) return;
  for (const row of transaction?.meta?.postTokenBalances || []) {
    if (row.mint !== mint || row.owner !== trader) continue;
    const amount = Number(row.uiTokenAmount?.amount || "0") / 10 ** (row.uiTokenAmount?.decimals || 0);
    if (Number.isFinite(amount)) balances.set(trader, amount);
  }
}

function ownerTokenDelta(pre: TokenBalance[] | undefined, post: TokenBalance[] | undefined, mint: string, owner: string) {
  return sumBalances(post, mint, owner) - sumBalances(pre, mint, owner);
}
function largestMintDelta(pre: TokenBalance[] | undefined, post: TokenBalance[] | undefined, mint: string) {
  const indexes = new Set([...(pre || []), ...(post || [])].filter((row) => row.mint === mint).map((row) => row.accountIndex));
  let largest = 0n;
  for (const index of indexes) { const delta = balanceAt(post, mint, index) - balanceAt(pre, mint, index); if (abs(delta) > abs(largest)) largest = delta; }
  return largest;
}
function sumBalances(rows: TokenBalance[] | undefined, mint: string, owner: string) { return (rows || []).filter((row) => row.mint === mint && row.owner === owner).reduce((total, row) => total + BigInt(row.uiTokenAmount?.amount || "0"), 0n); }
function balanceAt(rows: TokenBalance[] | undefined, mint: string, index: number) { return BigInt((rows || []).find((row) => row.mint === mint && row.accountIndex === index)?.uiTokenAmount?.amount || "0"); }
function abs(value: bigint) { return value < 0n ? -value : value; }

async function resolveTokenAccountOwners(rpcUrl: string, accounts: string[]) {
  const result = await rpcCall<{ value?: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> }>(rpcUrl, "getMultipleAccounts", [accounts, { encoding: "jsonParsed", commitment: "confirmed" }]);
  return (result.value || []).map((account) => account?.data?.parsed?.info?.owner || "");
}

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (!response.ok || payload.error || payload.result === undefined) throw new Error(payload.error?.message || `Solana RPC ${method} failed.`);
  return payload.result;
}

async function rpcBatch<T>(url: string, calls: Array<{ method: string; params: unknown[] }>) {
  const body = calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, ...call }));
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const payload = await response.json() as Array<{ id: number; result?: T }>;
  if (!response.ok || !Array.isArray(payload)) throw new Error("Solana transaction history failed.");
  return payload.sort((a, b) => a.id - b.id).map((row) => row.result as T);
}

function assertOk(response: Response) { if (!response.ok) throw new Error(`Market source returned ${response.status}.`); return response; }
function fetchMeteoraCandles(pool: string, timeframe: string, start: number, end: number) {
  return fetch(`https://damm-v2.datapi.meteora.ag/pools/${pool}/ohlcv?timeframe=${timeframe}&start_time=${start}&end_time=${end}`, { next: { revalidate: 15 }, signal: AbortSignal.timeout(6_000) })
    .then(assertOk)
    .then((response) => response.json() as Promise<{ data?: MeteoraCandle[] }>);
}
function numberOrNull(value: unknown) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
function validCandle(candle: MeteoraCandle) { return Number.isFinite(candle.timestamp) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close) && Number.isFinite(candle.volume); }
