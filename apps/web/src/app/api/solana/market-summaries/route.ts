import { NextRequest, NextResponse } from "next/server";
import { cachedResponse } from "@/lib/server/response-cache";

export const dynamic = "force-dynamic";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_MARKETS = 30;

type RequestedMarket = { mint: string; pool: string };
type DexPair = {
  pairAddress?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
};

export async function GET(request: NextRequest) {
  const markets = parseMarkets(request.nextUrl.searchParams.get("markets") || "");
  if (!markets.length) return NextResponse.json({ summaries: [] }, { status: 400 });

  const cacheKey = markets.map(({ mint, pool }) => `${mint}:${pool}`).sort().join("|");
  return cachedResponse(`solana-market-summaries:${cacheKey}`, 15_000, async () => {
    try {
      const mintList = [...new Set(markets.map(({ mint }) => mint))].join(",");
      const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mintList}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) throw new Error(`DEX Screener returned ${response.status}.`);
      const pairs = await response.json() as DexPair[];
      const summaries = markets.flatMap(({ mint, pool }) => {
        const pair = pairs.find((candidate) => candidate.pairAddress === pool)
          ?? pairs.find((candidate) => candidate.baseToken?.address === mint || candidate.quoteToken?.address === mint);
        if (!pair) return [];
        return [{
          mint,
          pool,
          marketCap: positiveNumber(pair.marketCap) ?? positiveNumber(pair.fdv),
          liquidityUsd: positiveNumber(pair.liquidity?.usd),
          volume24h: nonNegativeNumber(pair.volume?.h24),
          priceChange24h: finiteNumber(pair.priceChange?.h24),
          buys24h: nonNegativeNumber(pair.txns?.h24?.buys),
          sells24h: nonNegativeNumber(pair.txns?.h24?.sells)
        }];
      });
      return NextResponse.json({ summaries }, {
        headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=45" }
      });
    } catch (error) {
      console.error("Failed to load Solana market summaries", error);
      return NextResponse.json({ summaries: [] }, { status: 502 });
    }
  });
}

function parseMarkets(value: string): RequestedMarket[] {
  const unique = new Map<string, RequestedMarket>();
  for (const entry of value.split(",").slice(0, MAX_MARKETS)) {
    const [mint, pool] = entry.trim().split(":");
    if (!SOLANA_ADDRESS.test(mint || "") || !SOLANA_ADDRESS.test(pool || "")) continue;
    unique.set(`${mint}:${pool}`, { mint, pool });
  }
  return [...unique.values()];
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function positiveNumber(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}
