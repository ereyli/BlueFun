import { NextResponse } from "next/server";
import { getDbLaunchPage, getDbLaunches, type LaunchPageFilter, type LaunchPageSort } from "@/lib/db-launches";
import { getDeployedLaunches } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { getArcOnchainLaunches } from "@/lib/arc-launches";
import { chainIdFromParam } from "@/lib/chain-slug";
import { cachedResponse } from "@/lib/server/response-cache";
import { uiPreviewEnabled, uiPreviewLaunches } from "@/lib/ui-preview-data";
import { MARKET_PAGE_SIZE } from "@/lib/market-pagination";
import { getAllNetworkLaunchPage } from "@/lib/all-network-launches";
import { parseDisplayAmount } from "@/lib/market-math";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainParam = params.get("chain");
  const allNetworks = chainParam?.trim().toLowerCase() === "all";
  const chainId = chainIdFromParam(chainParam);
  const page = Number(params.get("page") || "1");
  const query = (params.get("q") || "").slice(0, 80);
  const requestedFilter = params.get("filter") || "All";
  const normalizedFilter = ["Activity", "Safe"].includes(requestedFilter) ? "All" : requestedFilter;
  const requestedSort = params.get("sort");
  const filters: LaunchPageFilter[] = ["All", "New", "Volume", "MarketCap", "Newest", "Direct", "Live", "Ready", "Graduated", "Progress"];
  const sort = (requestedSort ?? (
    normalizedFilter === "Volume" || normalizedFilter === "MarketCap" || normalizedFilter === "Progress" ? normalizedFilter
      : normalizedFilter === "New" || normalizedFilter === "Newest" ? "Newest"
        : "Activity"
  )) as LaunchPageSort;
  const sorts: LaunchPageSort[] = ["Activity", "Newest", "Volume", "MarketCap", "Progress"];
  if (!chainParam || !["all", "base", "robinhood", "monad", "stable", "arc", "8453", "4663", "143", "988", "5042"].includes(chainParam.toLowerCase()) || !Number.isInteger(page) || page < 1 || page > 100_000 || !filters.includes(normalizedFilter as LaunchPageFilter) || !sorts.includes(sort)) {
    return NextResponse.json({ launches: [], total: 0, page: 1, totalPages: 0 }, { status: 400 });
  }
  const filter = normalizedFilter as LaunchPageFilter;
  const load = () => allNetworks
    ? getAllNetworkLaunchPage({ filter, page, query, sort }).then((payload) => jsonLaunchPage(payload, query))
    : loadLaunchPage(chainId, page, query, filter, sort);
  return query
    ? load()
    : cachedResponse(`launch-page:${allNetworks ? "all" : chainId}:${page}:${filter}:${sort}`, 5_000, load);
}

async function loadLaunchPage(chainId: number, page: number, query: string, filter: LaunchPageFilter, sort: LaunchPageSort) {
  if (uiPreviewEnabled()) {
    return previewLaunchPage(page, query, filter, sort);
  }
  const indexed = await getDbLaunchPage(chainId, { page, pageSize: MARKET_PAGE_SIZE, query, filter, sort });
  if (indexed && (chainId !== 5042 || indexed.total > 0)) {
    return jsonLaunchPage({ ...indexed, page, totalPages: Math.ceil(indexed.total / MARKET_PAGE_SIZE) }, query);
  }

  const all = chainId === 5042
    ? await getArcOnchainLaunches().catch(() => [])
    : chainId === 143 || chainId === 988
    ? await getDbLaunches(chainId).then((value) => value ?? [])
    : chainId === 4663 ? await getRobinhoodLaunches() : await getDeployedLaunches();
  const source = all;
  const normalized = query.trim().toLowerCase();
  const filtered = source.filter((launch) => {
    const matchesQuery = !normalized || [launch.name, launch.symbol, launch.token, launch.creator].some((value) => value.toLowerCase().includes(normalized));
    if (!matchesQuery) return false;
    if (filter === "Direct") return launch.launchMode === "direct";
    if (filter === "Live" || filter === "Ready") return launch.launchMode !== "direct" && launch.status === filter;
    if (filter === "Graduated") return launch.launchMode !== "direct" && launch.status === "Graduated";
    if (filter === "Progress") return launch.launchMode !== "direct";
    return true;
  }).sort((a, b) => {
    if (sort === "Progress") return b.progress - a.progress || compareCreated(b, a);
    if (sort === "Volume") return numericMarketValue(b.volume) - numericMarketValue(a.volume) || compareCreated(b, a);
    if (sort === "MarketCap") return numericMarketValue(b.marketCap) - numericMarketValue(a.marketCap) || numericMarketValue(b.raised) - numericMarketValue(a.raised) || compareCreated(b, a);
    if (sort === "Activity") return numericMarketValue(b.volume) - numericMarketValue(a.volume) || numericMarketValue(b.marketCap) - numericMarketValue(a.marketCap) || numericMarketValue(b.raised) - numericMarketValue(a.raised) || compareCreated(b, a);
    return compareCreated(b, a);
  });
  const start = (page - 1) * MARKET_PAGE_SIZE;
  return jsonLaunchPage({
    launches: filtered.slice(start, start + MARKET_PAGE_SIZE),
    total: filtered.length,
    page,
    totalPages: Math.ceil(filtered.length / MARKET_PAGE_SIZE)
  }, query);
}

function previewLaunchPage(page: number, query: string, filter: LaunchPageFilter, sort: LaunchPageSort) {
  const normalized = query.trim().toLowerCase();
  const launches = uiPreviewLaunches.filter((launch) => {
    const matchesQuery = !normalized || [launch.name, launch.symbol, launch.token, launch.creator].some((value) => value.toLowerCase().includes(normalized));
    if (!matchesQuery) return false;
    if (filter === "Direct" || filter === "Graduated") return false;
    return true;
  }).sort((a, b) => {
    if (sort === "Volume") return numericMarketValue(b.volume) - numericMarketValue(a.volume);
    if (sort === "MarketCap") return numericMarketValue(b.marketCap) - numericMarketValue(a.marketCap);
    if (sort === "Newest") return compareCreated(b, a);
    return numericMarketValue(b.volume) - numericMarketValue(a.volume);
  });
  return jsonLaunchPage({
    launches: page === 1 ? launches : [],
    total: query ? launches.length : 128,
    page,
    totalPages: query ? Math.max(1, Math.ceil(launches.length / MARKET_PAGE_SIZE)) : Math.ceil(128 / MARKET_PAGE_SIZE)
  }, query);
}

function numericMarketValue(value: string) {
  return parseDisplayAmount(value);
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
