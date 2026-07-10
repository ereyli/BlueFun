import { unstable_cache } from "next/cache";
import { getDbLaunchMetrics, getDbLaunchPage } from "@/lib/db-launches";

export const getCachedLaunchOverview = unstable_cache(
  async (chainId: number) => {
    const [page, metrics] = await Promise.all([
      getDbLaunchPage(chainId, { page: 1, pageSize: 21 }),
      getDbLaunchMetrics(chainId)
    ]);
    return { page, metrics };
  },
  ["launch-overview-v1"],
  { revalidate: 10 }
);
