import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getDeployedLaunch } from "@/lib/onchain-launches";
import { siteUrl } from "@/lib/site-url";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";
import { getRobinhoodLaunch } from "@/lib/robinhood-launches";
import { unstable_cache } from "next/cache";
import { chainIdFromParam } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";

export const revalidate = 15;

type LaunchParams = { params: Promise<{ id: string }>; searchParams: Promise<{ chain?: string }> };

const getCachedLaunch = unstable_cache(
  async (id: string, chainId: number) => chainId === 4663 ? getRobinhoodLaunch(id) : getDeployedLaunch(id),
  ["market-launch-v1"],
  { revalidate: 15 }
);

export async function generateMetadata({ params, searchParams }: LaunchParams): Promise<Metadata> {
  const { id } = await params;
  const chainId = chainIdFromParam((await searchParams).chain);
  const launch = await getCachedLaunch(id, chainId).catch(() => undefined);
  if (!launch) {
    return {
      title: "BlueFun Market",
      description: "Trade B20 launches on BlueFun."
    };
  }

  const title = `${launch.name} ($${launch.symbol}) on BlueFun`;
  const description = launch.description || `Trade $${launch.symbol} on the BlueFun bonding curve.`;
  const url = siteUrl(tokenPath(launch));
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
      site: "@BluefunLaunch",
      creator: "@BluefunLaunch",
      title,
      description,
      images: [image]
    }
  };
}

export default async function LaunchMarketPage({ params, searchParams }: LaunchParams) {
  const { id } = await params;
  const chainId = chainIdFromParam((await searchParams).chain);
  const launch = await getCachedLaunch(id, chainId);
  if (!launch) notFound();
  permanentRedirect(tokenPath(launch));
}
