import { NextResponse } from "next/server";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getDbMarketSparklines } from "@/lib/db-launches";
import { cachedResponse } from "@/lib/server/response-cache";

export const dynamic = "force-dynamic";

const supportedChains = ["base", "robinhood", "monad", "stable", "arc", "8453", "4663", "143", "988", "5042"];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainParam = params.get("chain");
  const keys = (params.get("keys") || "").split(",").map((key) => key.trim()).filter(Boolean).slice(0, 30);
  if (!chainParam || !supportedChains.includes(chainParam.toLowerCase()) || keys.length === 0) {
    return NextResponse.json({ sparklines: [] }, { status: 400 });
  }
  const chainId = chainIdFromParam(chainParam);
  const cacheKey = keys.slice().sort().join("|");
  return cachedResponse(`market-sparklines:${chainId}:${cacheKey}`, 10_000, async () => {
    const sparklines = await getDbMarketSparklines(chainId, keys);
    return NextResponse.json({ sparklines: sparklines ?? [] }, {
      headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" }
    });
  });
}
