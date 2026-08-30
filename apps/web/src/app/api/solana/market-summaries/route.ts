import { NextRequest, NextResponse } from "next/server";
import { cachedResponse } from "@/lib/server/response-cache";
import { getNativeUsdPrice } from "@/lib/native-usd";

export const dynamic = "force-dynamic";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_MARKETS = 30;
const WSOL = "So11111111111111111111111111111111111111112";

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
type MeteoraToken = { address?: string; total_supply?: number };
type MeteoraPool = {
  token_x?: MeteoraToken; token_y?: MeteoraToken;
  token_x_amount?: number; token_y_amount?: number;
  current_price?: number; tvl?: number;
  volume?: { "24h"?: number };
};

export async function GET(request: NextRequest) {
  const markets = parseMarkets(request.nextUrl.searchParams.get("markets") || "");
  if (!markets.length) return NextResponse.json({ summaries: [] }, { status: 400 });

  const cacheKey = markets.map(({ mint, pool }) => `${mint}:${pool}`).sort().join("|");
  return cachedResponse(`solana-market-summaries:${cacheKey}`, 15_000, async () => {
    try {
      const mintList = [...new Set(markets.map(({ mint }) => mint))].join(",");
      const pairs = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mintList}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000)
      })
        .then((response) => response.ok ? response.json() as Promise<DexPair[]> : [])
        .catch(() => [] as DexPair[]);
      const missing = markets.filter(({ mint, pool }) => !pairs.some((candidate) => candidate.pairAddress === pool)
        && !pairs.some((candidate) => candidate.baseToken?.address === mint || candidate.quoteToken?.address === mint));
      const [solUsd, meteoraRows] = await Promise.all([
        missing.length ? getNativeUsdPrice(101) : Promise.resolve(null),
        mapWithConcurrency(missing, 6, async ({ mint, pool }) => {
          try {
            const response = await fetch(`https://damm-v2.datapi.meteora.ag/pools/${pool}`, {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(6_000)
            });
            if (!response.ok) return undefined;
            return { mint, pool, data: await response.json() as MeteoraPool };
          } catch {
            return undefined;
          }
        })
      ]);
      const meteoraByPool = new Map(meteoraRows.filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => [row.pool, row]));
      const summaries = markets.flatMap(({ mint, pool }) => {
        const pair = pairs.find((candidate) => candidate.pairAddress === pool)
          ?? pairs.find((candidate) => candidate.baseToken?.address === mint || candidate.quoteToken?.address === mint);
        if (!pair) {
          const meteora = meteoraByPool.get(pool)?.data;
          const priceNative = meteora ? meteoraPriceNative(meteora, mint) : null;
          const supply = meteoraToken(meteora, mint)?.total_supply;
          if (!meteora) return [];
          return [{
            mint,
            pool,
            marketCap: priceNative && solUsd && supply ? priceNative * solUsd * supply : null,
            liquidityUsd: positiveNumber(meteora.tvl),
            volume24h: nonNegativeNumber(meteora.volume?.["24h"]),
            priceChange24h: null,
            buys24h: null,
            sells24h: null
          }];
        }
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

function meteoraToken(pool: MeteoraPool | undefined, mint: string) {
  if (pool?.token_x?.address === mint) return pool.token_x;
  if (pool?.token_y?.address === mint) return pool.token_y;
  return undefined;
}

function meteoraPriceNative(pool: MeteoraPool, mint: string) {
  const price = positiveNumber(pool.current_price);
  if (!price) return null;
  if (pool.token_x?.address === mint && pool.token_y?.address === WSOL) return price;
  if (pool.token_y?.address === mint && pool.token_x?.address === WSOL) return 1 / price;
  return null;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}
