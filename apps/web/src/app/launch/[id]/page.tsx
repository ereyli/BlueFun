import { MarketClient } from "./market-client";
import { getDeployedLaunch, getLaunchTrades } from "@/lib/onchain-launches";

export const dynamic = "force-dynamic";

export default async function LaunchMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [launch, trades] = await Promise.all([getDeployedLaunch(id), getLaunchTrades(id)]);
  return <MarketClient id={id} launch={launch} trades={trades} />;
}
