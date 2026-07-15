import { NextResponse } from "next/server";
import { getDbLaunchPage, type LaunchPageFilter } from "@/lib/db-launches";
import { getDeployedLaunches } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { chainIdFromParam } from "@/lib/chain-slug";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainParam = params.get("chain");
  const chainId = chainIdFromParam(chainParam);
  const page = Number(params.get("page") || "1");
  const query = (params.get("q") || "").slice(0, 80);
  const requestedFilter = params.get("filter") || "All";
  const normalizedFilter = ["Activity", "Safe"].includes(requestedFilter) ? "All" : requestedFilter;
  const filters: LaunchPageFilter[] = ["All", "New", "Volume", "MarketCap", "Newest", "Direct", "Live", "Ready", "Graduated", "Progress"];
  if (!chainParam || !["base", "robinhood", "8453", "4663"].includes(chainParam.toLowerCase()) || !Number.isInteger(page) || page < 1 || page > 100_000 || !filters.includes(normalizedFilter as LaunchPageFilter)) {
    return NextResponse.json({ launches: [], total: 0, page: 1, totalPages: 0 }, { status: 400 });
  }
  const filter = normalizedFilter as LaunchPageFilter;
  const indexed = await getDbLaunchPage(chainId, { page, pageSize: 21, query, filter });
  if (indexed) return jsonLaunchPage({ ...indexed, page, totalPages: Math.ceil(indexed.total / 21) }, query);

  const all = chainId === 4663 ? await getRobinhoodLaunches() : await getDeployedLaunches();
  const normalized = query.trim().toLowerCase();
  const filtered = all.filter((launch) => {
    const matchesQuery = !normalized || [launch.name, launch.symbol, launch.token, launch.creator].some((value) => value.toLowerCase().includes(normalized));
    if (!matchesQuery) return false;
    if (filter === "Direct") return launch.launchMode === "direct";
    if (filter === "Live" || filter === "Ready") return launch.launchMode !== "direct" && launch.status === filter;
    if (filter === "Graduated") return launch.launchMode !== "direct" && launch.status === "Graduated";
    if (filter === "Progress") return launch.launchMode !== "direct";
    return true;
  }).sort((a, b) => {
    if (filter === "Progress") return b.progress - a.progress || compareCreated(b, a);
    if (filter === "Volume") return numericMarketValue(b.volume) - numericMarketValue(a.volume) || compareCreated(b, a);
    if (filter === "MarketCap") return numericMarketValue(b.marketCap) - numericMarketValue(a.marketCap) || numericMarketValue(b.raised) - numericMarketValue(a.raised) || compareCreated(b, a);
    return compareCreated(b, a);
  });
  const start = (page - 1) * 21;
  return jsonLaunchPage({ launches: filtered.slice(start, start + 21), total: filtered.length, page, totalPages: Math.ceil(filtered.length / 21) }, query);
}

function numericMarketValue(value: string) {
  const parsed = Number.parseFloat(value.replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareCreated(left: { createdBlock?: string; id: string }, right: { createdBlock?: string; id: string }) {
  const leftBlock = BigInt(left.createdBlock || "0");
  const rightBlock = BigInt(right.createdBlock || "0");
  if (leftBlock !== rightBlock) return leftBlock > rightBlock ? 1 : -1;
  const leftId = BigInt(left.id || "0");
  const rightId = BigInt(right.id || "0");
  return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
}

function jsonLaunchPage(payload: object, query: string) {
  return NextResponse.json(payload, {
    headers: {
      "cache-control": query
        ? "private, no-store"
        : "public, s-maxage=10, stale-while-revalidate=60"
    }
  });
}
