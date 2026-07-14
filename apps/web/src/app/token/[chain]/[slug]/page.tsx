import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { MarketClient } from "@/app/launch/[id]/market-client";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getDbLaunchByTokenSuffix, getDbTrades } from "@/lib/db-launches";
import { getDeployedLaunches, getLaunchTrades } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { siteUrl } from "@/lib/site-url";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";
import { tokenPath, tokenSlug, tokenSuffixFromSlug } from "@/lib/token-url";

export const revalidate = 15;

type TokenParams = { params: Promise<{ chain: string; slug: string }> };

const getCachedLaunchBySuffix = unstable_cache(
  async (suffix: string, chainId: number) => {
    const indexed = await getDbLaunchByTokenSuffix(suffix, chainId);
    if (indexed) return indexed;
    const launches = chainId === 4663 ? await getRobinhoodLaunches() : await getDeployedLaunches();
    const matches = launches.filter((launch) => launch.token.toLowerCase().endsWith(suffix.toLowerCase()));
    return matches.length === 1 ? matches[0] : undefined;
  },
  ["market-launch-token-v1"],
  { revalidate: 15 }
);

const getCachedTokenTrades = unstable_cache(
  async (launchId: string, chainId: number, scope?: string) => scope
    ? getDbTrades(launchId, chainId, scope).then((value) => value ?? [])
    : chainId === 4663
      ? getDbTrades(launchId, 4663).then((value) => value ?? [])
      : getLaunchTrades(launchId),
  ["market-token-trades-v1"],
  { revalidate: 10 }
);

export async function generateMetadata({ params }: TokenParams): Promise<Metadata> {
  const { chain, slug } = await params;
  const launch = await resolveTokenLaunch(chain, slug);
  if (!launch) return { title: "BlueFun Market", description: "Trade token launches on BlueFun." };

  const title = `${launch.name} ($${launch.symbol}) on BlueFun`;
  const description = launch.description || `Trade $${launch.symbol} on the BlueFun bonding curve.`;
  const url = siteUrl(tokenPath(launch));
  const image = ipfsToGatewayUrl(launch.imageURI) || siteUrl("/brand/bluelogo.webp");
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "BlueFun", type: "website", images: [{ url: image, width: 1200, height: 630, alt: `${launch.name} token logo` }] },
    twitter: { card: "summary_large_image", site: "@BluefunLaunch", creator: "@BluefunLaunch", title, description, images: [image] }
  };
}

export default async function TokenMarketPage({ params }: TokenParams) {
  const { chain, slug } = await params;
  const launch = await resolveTokenLaunch(chain, slug);
  if (!launch) notFound();
  if (slug !== tokenSlug(launch) || chain !== (launch.chainId === 4663 ? "robinhood" : "base")) permanentRedirect(tokenPath(launch));
  const trades = await getCachedTokenTrades(launch.id, launch.chainId, launch.scope);
  return <MarketClient id={launch.id} launch={launch} trades={trades} />;
}

async function resolveTokenLaunch(chain: string, slug: string) {
  if (chain !== "base" && chain !== "robinhood") return undefined;
  const suffix = tokenSuffixFromSlug(slug);
  if (!suffix) return undefined;
  return getCachedLaunchBySuffix(suffix, chainIdFromParam(chain)).catch(() => undefined);
}
