import type { Metadata } from "next";
import { MarketClient } from "./market-client";
import { getDeployedLaunch, getLaunchTrades } from "@/lib/onchain-launches";
import { siteUrl } from "@/lib/site-url";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";

export const dynamic = "force-dynamic";

type LaunchParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: LaunchParams): Promise<Metadata> {
  const { id } = await params;
  const launch = await getDeployedLaunch(id).catch(() => undefined);
  if (!launch) {
    return {
      title: "BlueFun Market",
      description: "Trade B20 launches on BlueFun."
    };
  }

  const title = `${launch.name} ($${launch.symbol}) on BlueFun`;
  const description = launch.description || `Trade $${launch.symbol} on the BlueFun bonding curve.`;
  const url = siteUrl(`/launch/${id}`);
  const image = ipfsToGatewayUrl(launch.imageURI) || siteUrl("/brand/funblue-icon.png");

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

export default async function LaunchMarketPage({ params }: LaunchParams) {
  const { id } = await params;
  const [launch, trades] = await Promise.all([getDeployedLaunch(id), getLaunchTrades(id)]);
  return <MarketClient id={id} launch={launch} trades={trades} />;
}
