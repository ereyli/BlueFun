import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { getCachedLaunchOverview } from "@/lib/launch-overview";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getDbLaunches } from "@/lib/db-launches";

export const revalidate = 10;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const chainId = chainIdFromParam((await searchParams).chain);
  const [baseOverview, robinhoodOverview, monadOverview, stableOverview, arcOverview] = await Promise.all([
    getCachedLaunchOverview(8453),
    getCachedLaunchOverview(4663),
    getCachedLaunchOverview(143),
    getCachedLaunchOverview(988),
    getCachedLaunchOverview(5042)
  ]);
  const overview = chainId === 5042 ? arcOverview : chainId === 988 ? stableOverview : chainId === 143 ? monadOverview : chainId === 4663 ? robinhoodOverview : baseOverview;
  const { page, metrics } = overview;
  const fallback = page ? undefined : await (chainId === 143 || chainId === 988 || chainId === 5042
    ? getDbLaunches(chainId).then((value) => value ?? [])
    : chainId === 4663 ? getRobinhoodLaunches() : getDeployedLaunches());
  const launches = page?.launches ?? fallback?.slice(0, 21) ?? [];
  return <LaunchExplorer launches={launches} totalLaunches={page?.total ?? fallback?.length ?? launches.length} metrics={metrics} networkMetrics={{ 8453: baseOverview.metrics, 4663: robinhoodOverview.metrics, 143: monadOverview.metrics, 988: stableOverview.metrics, 5042: arcOverview.metrics }} chainId={chainId} />;
}
