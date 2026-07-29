import { unstable_cache } from "next/cache";
import { getDbLaunchMetrics, getDbLaunchPage } from "@/lib/db-launches";
import { getArcOnchainLaunches } from "@/lib/arc-launches";

export const getCachedLaunchOverview = unstable_cache(
  async (chainId: number) => {
    const [page, metrics] = await Promise.all([
      getDbLaunchPage(chainId, { page: 1, pageSize: 21 }),
      getDbLaunchMetrics(chainId)
    ]);
    if (chainId === 5042 && (!page || page.total === 0)) {
      const launches = await getArcOnchainLaunches().catch((error) => {
        console.error("Failed to load Arc onchain overview fallback", error);
        return [];
      });
      if (launches.length) {
        return {
          page: { launches: launches.slice(0, 21), total: launches.length },
          metrics: {
            totalVolumeEth: 0,
            totalTokens: launches.length,
            totalCreators: new Set(launches.map((launch) => launch.creator.toLowerCase())).size,
            totalGraduated: launches.length
          }
        };
      }
    }
    return { page, metrics };
  },
  ["launch-overview-v2"],
  { revalidate: 10 }
);
