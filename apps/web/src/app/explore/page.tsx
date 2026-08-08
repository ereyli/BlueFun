import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { getCachedLaunchOverview } from "@/lib/launch-overview";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getDbLaunches } from "@/lib/db-launches";
import { uiPreviewEnabled, uiPreviewLaunches } from "@/lib/ui-preview-data";
import { MARKET_PAGE_SIZE } from "@/lib/market-pagination";

export const revalidate = 10;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const chainId = chainIdFromParam((await searchParams).chain);
  if (uiPreviewEnabled()) {
    return <LaunchExplorer launches={uiPreviewLaunches} totalLaunches={128} chainId={chainId} />;
  }
  const { page } = await getCachedLaunchOverview(chainId);
  const fallback = page ? undefined : await (chainId === 101 || chainId === 143 || chainId === 988 || chainId === 5042
    ? getDbLaunches(chainId).then((value) => value ?? [])
    : chainId === 4663 ? getRobinhoodLaunches() : getDeployedLaunches());
  const launches = page?.launches ?? fallback?.slice(0, MARKET_PAGE_SIZE) ?? [];
  return <LaunchExplorer launches={launches} totalLaunches={page?.total ?? fallback?.length ?? launches.length} chainId={chainId} />;
}
