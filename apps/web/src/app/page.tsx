import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { getCachedLaunchOverview } from "@/lib/launch-overview";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getDbLaunches } from "@/lib/db-launches";
import { uiPreviewEnabled, uiPreviewLaunches } from "@/lib/ui-preview-data";
import { MARKET_PAGE_SIZE } from "@/lib/market-pagination";
import { getAllNetworkLaunchPage } from "@/lib/all-network-launches";

export const revalidate = 10;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ chain?: string; q?: string }> }) {
  const params = await searchParams;
  const allNetworks = params.chain?.trim().toLowerCase() === "all";
  const chainId = chainIdFromParam(params.chain);
  if (uiPreviewEnabled()) {
    return <LaunchExplorer launches={uiPreviewLaunches} totalLaunches={128} chainId={allNetworks ? 0 : chainId} initialQuery={params.q || ""} />;
  }
  if (allNetworks) {
    const page = await getAllNetworkLaunchPage({ query: params.q || "" });
    return <LaunchExplorer launches={page.launches} totalLaunches={page.total} chainId={0} initialQuery={params.q || ""} />;
  }
  const { page } = await getCachedLaunchOverview(chainId);
  const fallback = page ? undefined : await (chainId === 101 || chainId === 143 || chainId === 988 || chainId === 5042
    ? getDbLaunches(chainId).then((value) => value ?? [])
    : chainId === 4663 ? getRobinhoodLaunches() : getDeployedLaunches());
  const liveLaunches = page?.launches ?? fallback?.slice(0, MARKET_PAGE_SIZE) ?? [];
  return <LaunchExplorer launches={liveLaunches} totalLaunches={page?.total ?? fallback?.length ?? liveLaunches.length} chainId={chainId} initialQuery={params.q || ""} />;
}
