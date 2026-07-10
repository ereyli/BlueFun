import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getDbLaunchMetrics, getDbLaunchPage } from "@/lib/db-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const requested = Number((await searchParams).chain);
  const chainId = requested === 4663 ? 4663 : 8453;
  const [page, metrics] = await Promise.all([
    getDbLaunchPage(chainId, { page: 1, pageSize: 21 }),
    getDbLaunchMetrics(chainId)
  ]);
  const fallback = page ? undefined : await (chainId === 4663 ? getRobinhoodLaunches() : getDeployedLaunches());
  const launches = page?.launches ?? fallback?.slice(0, 21) ?? [];
  return <LaunchExplorer launches={launches} totalLaunches={page?.total ?? fallback?.length ?? launches.length} metrics={metrics} chainId={chainId} />;
}
