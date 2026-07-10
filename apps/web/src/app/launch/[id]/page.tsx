import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketClient } from "./market-client";
import { getDeployedLaunch, getLaunchTrades } from "@/lib/onchain-launches";
import { siteUrl } from "@/lib/site-url";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";
import { getRobinhoodLaunch } from "@/lib/robinhood-launches";
import { getDbTrades } from "@/lib/db-launches";
import { unstable_cache } from "next/cache";

export const revalidate = 15;

type LaunchParams = { params: Promise<{ id: string }>; searchParams: Promise<{ chain?: string }> };

const getCachedLaunch = unstable_cache(
  async (id: string, chainId: number) => chainId === 4663 ? getRobinhoodLaunch(id) : getDeployedLaunch(id),
  ["market-launch-v1"],
  { revalidate: 15 }
);

const getCachedTrades = unstable_cache(
  async (id: string, chainId: number) => chainId === 4663
    ? getDbTrades(id, 4663).then((value) => value ?? [])
    : getLaunchTrades(id),
  ["market-trades-v1"],
  { revalidate: 10 }
);

export async function generateMetadata({ params, searchParams }: LaunchParams): Promise<Metadata> {
  const { id } = await params;
  const isRobinhood = Number((await searchParams).chain) === 4663;
  const launch = await getCachedLaunch(id, isRobinhood ? 4663 : 8453).catch(() => undefined);
  if (!launch) {
    return {
      title: "BlueFun Market",
      description: "Trade B20 launches on BlueFun."
    };
  }

  const title = `${launch.name} ($${launch.symbol}) on BlueFun`;
  const description = launch.description || `Trade $${launch.symbol} on the BlueFun bonding curve.`;
  const url = siteUrl(`/launch/${id}${isRobinhood ? "?chain=4663" : ""}`);
  const image = ipfsToGatewayUrl(launch.imageURI) || siteUrl("/brand/bluelogo.webp");

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "BlueFun",
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: `${launch.name} token logo` }]
    },
    twitter: {
      card: "summary_large_image",
      site: "@B20base",
      creator: "@B20base",
      title,
      description,
      images: [image]
    }
  };
}

export default async function LaunchMarketPage({ params, searchParams }: LaunchParams) {
  const { id } = await params;
  const isRobinhood = Number((await searchParams).chain) === 4663;
  const chainId = isRobinhood ? 4663 : 8453;
  const [launch, trades] = await Promise.all([
    getCachedLaunch(id, chainId),
    getCachedTrades(id, chainId)
  ]);
  if (!launch) notFound();
  return <MarketClient id={id} launch={launch} trades={trades} />;
}
