import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { getCachedLaunchOverview } from "@/lib/launch-overview";

export const revalidate = 10;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const requested = Number((await searchParams).chain);
  const chainId = requested === 4663 ? 4663 : 8453;
  const { page, metrics } = await getCachedLaunchOverview(chainId);
  const fallback = page ? undefined : await (chainId === 4663 ? getRobinhoodLaunches() : getDeployedLaunches());
  const launches = page?.launches ?? fallback?.slice(0, 21) ?? [];
  return <LaunchExplorer launches={launches} totalLaunches={page?.total ?? fallback?.length ?? launches.length} metrics={metrics} chainId={chainId} />;
}
