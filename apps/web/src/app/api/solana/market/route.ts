import { NextRequest, NextResponse } from "next/server";

export const revalidate = 15;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type DexPair = {
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  url?: string;
};

type MeteoraCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export async function GET(request: NextRequest) {
  const pool = request.nextUrl.searchParams.get("pool")?.trim() || "";
  if (!SOLANA_ADDRESS.test(pool)) return NextResponse.json({ error: "Invalid Solana pool." }, { status: 400 });

  const now = Math.floor(Date.now() / 1_000);
  const start = now - 6 * 60 * 60;
  const [dexResult, candleResult] = await Promise.allSettled([
    fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pool}`, { next: { revalidate: 15 }, signal: AbortSignal.timeout(8_000) }).then(assertOk).then((response) => response.json()),
    fetch(`https://damm-v2.datapi.meteora.ag/pools/${pool}/ohlcv?timeframe=5m&start_time=${start}&end_time=${now}`, { next: { revalidate: 15 }, signal: AbortSignal.timeout(8_000) }).then(assertOk).then((response) => response.json())
  ]);

  const dexPayload = dexResult.status === "fulfilled" ? dexResult.value as { pair?: DexPair; pairs?: DexPair[] } : undefined;
  const pair = dexPayload?.pair || dexPayload?.pairs?.[0];
  const candlePayload = candleResult.status === "fulfilled" ? candleResult.value as { data?: MeteoraCandle[] } : undefined;
  if (!pair && !candlePayload?.data?.length) return NextResponse.json({ error: "Market data is not available yet." }, { status: 502 });

  const candles = (candlePayload?.data || []).filter(validCandle).map((candle) => ({
    time: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));

  return NextResponse.json({
    priceUsd: numberOrNull(pair?.priceUsd),
    priceNative: numberOrNull(pair?.priceNative) ?? candles.at(-1)?.close ?? null,
    liquidityUsd: numberOrNull(pair?.liquidity?.usd),
    fdv: numberOrNull(pair?.fdv),
    marketCap: numberOrNull(pair?.marketCap),
    volume24h: numberOrNull(pair?.volume?.h24),
    priceChange24h: numberOrNull(pair?.priceChange?.h24),
    buys24h: numberOrNull(pair?.txns?.h24?.buys),
    sells24h: numberOrNull(pair?.txns?.h24?.sells),
    pairCreatedAt: numberOrNull(pair?.pairCreatedAt),
    pairUrl: pair?.url || `https://dexscreener.com/solana/${pool}`,
    candles
  }, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=45" } });
}

function assertOk(response: Response) {
  if (!response.ok) throw new Error(`Market source returned ${response.status}.`);
  return response;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function validCandle(candle: MeteoraCandle) {
  return Number.isFinite(candle.timestamp) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close) && Number.isFinite(candle.volume);
}
