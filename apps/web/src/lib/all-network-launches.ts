import { getArcOnchainLaunches } from "@/lib/arc-launches";
import { getDbLaunches, type LaunchPageFilter, type LaunchPageSort } from "@/lib/db-launches";
import { MARKET_PAGE_SIZE } from "@/lib/market-pagination";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { getDeployedLaunches } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { parseDisplayAmount } from "@/lib/market-math";
import { getNativeUsdPrice } from "@/lib/native-usd";

const ALL_MARKET_NETWORKS = [8453, 4663, 143, 988, 5042, 101] as const;

export async function getAllNetworkLaunches() {
  const groups = await Promise.all(ALL_MARKET_NETWORKS.map(async (chainId) => {
    const indexed = await getDbLaunches(chainId, { limit: 80 });
    if (indexed?.length) return indexed;
    if (chainId === 8453) return getDeployedLaunches();
    if (chainId === 4663) return getRobinhoodLaunches();
    if (chainId === 5042) return getArcOnchainLaunches().catch(() => []);
    return [];
  }));
  return dedupeLaunches(groups.flat());
}

export async function getAllNetworkLaunchPage({
  filter = "All",
  page = 1,
  query = "",
  sort = "Activity"
}: {
  filter?: LaunchPageFilter;
  page?: number;
  query?: string;
  sort?: LaunchPageSort;
}) {
  const launches = await getAllNetworkLaunches();
  const nativeUsdByChain = sort === "Newest"
    ? new Map<number, number | null>()
    : new Map(await Promise.all(ALL_MARKET_NETWORKS.map(async (chainId) => [chainId, await getNativeUsdPrice(chainId)] as const)));
  const normalized = query.trim().toLowerCase();
  const filtered = launches.filter((launch) => {
    const matchesQuery = !normalized || [launch.name, launch.symbol, launch.token, launch.creator, String(launch.chainId)]
      .some((value) => value.toLowerCase().includes(normalized));
    if (!matchesQuery) return false;
    if (filter === "Direct") return launch.launchMode === "direct";
    if (filter === "Live" || filter === "Ready") return launch.launchMode !== "direct" && launch.status === filter;
    if (filter === "Graduated") return launch.launchMode !== "direct" && launch.status === "Graduated";
    if (filter === "Progress") return launch.launchMode !== "direct";
    return true;
  }).sort((a, b) => {
    if (sort === "Progress") return b.progress - a.progress || compareNewest(a, b);
    if (sort === "Volume") return usdValue(b.volume, b.chainId, nativeUsdByChain) - usdValue(a.volume, a.chainId, nativeUsdByChain) || compareNewest(a, b);
    if (sort === "MarketCap") return marketCapUsd(b, nativeUsdByChain) - marketCapUsd(a, nativeUsdByChain) || compareNewest(a, b);
    if (sort === "Activity") return usdValue(b.volume, b.chainId, nativeUsdByChain) - usdValue(a.volume, a.chainId, nativeUsdByChain)
      || marketCapUsd(b, nativeUsdByChain) - marketCapUsd(a, nativeUsdByChain)
      || compareNewest(a, b);
    return compareNewest(a, b);
  });
  const safePage = Math.max(1, Math.floor(page));
  const start = (safePage - 1) * MARKET_PAGE_SIZE;
  return {
    launches: filtered.slice(start, start + MARKET_PAGE_SIZE),
    page: safePage,
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / MARKET_PAGE_SIZE)
  };
}

function dedupeLaunches(launches: DeployedLaunch[]) {
  const seen = new Set<string>();
  return launches.filter((launch) => {
    const key = `${launch.chainId}:${launch.token.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function usdValue(value: string, chainId: number, prices: Map<number, number | null>) {
  const nativeValue = parseDisplayAmount(value);
  const nativeUsd = prices.get(chainId);
  return nativeValue * (nativeUsd && nativeUsd > 0 ? nativeUsd : 0);
}

function marketCapUsd(launch: DeployedLaunch, prices: Map<number, number | null>) {
  return usdValue(launch.marketCap, launch.chainId, prices) || usdValue(launch.raised, launch.chainId, prices);
}

function compareNewest(left: DeployedLaunch, right: DeployedLaunch) {
  const ageDelta = ageSeconds(left.age) - ageSeconds(right.age);
  if (ageDelta !== 0) return ageDelta;
  if (left.chainId === right.chainId) return compareCreated(right, left);
  return left.chainId - right.chainId;
}

function ageSeconds(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "live" || normalized === "now") return 0;
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(mo|s|m|h|d|w|y)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "s" ? 1
    : unit === "m" ? 60
      : unit === "h" ? 3_600
        : unit === "d" ? 86_400
          : unit === "w" ? 604_800
            : unit === "mo" ? 2_592_000
              : 31_536_000;
  return amount * multiplier;
}

function compareCreated(left: { createdBlock?: string; id: string }, right: { createdBlock?: string; id: string }) {
  const leftBlock = safeBigInt(left.createdBlock || left.id);
  const rightBlock = safeBigInt(right.createdBlock || right.id);
  return leftBlock === rightBlock ? 0 : leftBlock > rightBlock ? 1 : -1;
}

function safeBigInt(value: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}
