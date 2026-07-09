import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getDbLaunchMetrics } from "@/lib/db-launches";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const [launches, metrics] = await Promise.all([
    getDeployedLaunches(),
    getDbLaunchMetrics()
  ]);
  return <LaunchExplorer launches={launches} metrics={metrics} />;
}
