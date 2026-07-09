import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getDbLaunchMetrics } from "@/lib/db-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";

export const dynamic = "force-dynamic";

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const requested = Number((await searchParams).chain);
  const chainId = requested === 4663 ? 4663 : 8453;
  const [launches, metrics] = await Promise.all([
    chainId === 4663 ? getRobinhoodLaunches() : getDeployedLaunches(),
    chainId === 4663 ? undefined : getDbLaunchMetrics()
  ]);
  return <LaunchExplorer launches={launches} metrics={metrics} chainId={chainId} />;
}
