import { getDeployedLaunches } from "@/lib/onchain-launches";
import { LaunchExplorer } from "@/components/launch-explorer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const launches = await getDeployedLaunches();
  return <LaunchExplorer launches={launches} />;
}
