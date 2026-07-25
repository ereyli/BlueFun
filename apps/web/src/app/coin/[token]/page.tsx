import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { MarketClient } from "@/app/launch/[id]/market-client";
import { getDbLaunchByToken, getDbTrades } from "@/lib/db-launches";
import { getDeployedLaunches, getLaunchTrades } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { siteUrl } from "@/lib/site-url";
import { tokenPath } from "@/lib/token-url";

export const revalidate = 15;

type CoinParams = { params: Promise<{ token: string }> };

const getCachedCoinLaunch = unstable_cache(
  async (token: string) => {
    const indexed = await Promise.all([8453, 4663, 143, 988].map((chainId) => getDbLaunchByToken(token, chainId)));
    const indexedMatch = indexed.find(Boolean);
    if (indexedMatch) return indexedMatch;

    const [base, robinhood] = await Promise.all([getDeployedLaunches(), getRobinhoodLaunches()]);
    return [...base, ...robinhood].find((launch) => launch.token.toLowerCase() === token.toLowerCase());
  },
  ["market-coin-v1"],
  { revalidate: 15 }
);

const getCachedCoinTrades = unstable_cache(
  async (launchId: string, chainId: number, scope?: string) => scope
    ? getDbTrades(launchId, chainId, scope).then((value) => value ?? [])
    : chainId !== 8453
      ? getDbTrades(launchId, chainId).then((value) => value ?? [])
      : getLaunchTrades(launchId),
  ["market-coin-trades-v1"],
  { revalidate: 10 }
);

export async function generateMetadata({ params }: CoinParams): Promise<Metadata> {
  const { token } = await params;
  const launch = await resolveCoin(token);
  if (!launch) return { title: "BlueFun Market", description: "Trade token launches on BlueFun." };

  const title = `${launch.name} ($${launch.symbol}) on BlueFun`;
  const description = launch.description || `Trade $${launch.symbol} on the BlueFun bonding curve.`;
  const url = siteUrl(tokenPath(launch));
  const image = siteUrl(`/api/token/share-card?chain=${launch.chainId}&token=${encodeURIComponent(launch.token)}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "BlueFun", type: "website", images: [{ url: image, width: 1200, height: 630, alt: `${launch.name} social share card` }] },
    twitter: { card: "summary_large_image", site: "@BluefunLaunch", creator: "@BluefunLaunch", title, description, images: [image] }
  };
}

export default async function CoinMarketPage({ params }: CoinParams) {
  const { token } = await params;
  const launch = await resolveCoin(token);
  if (!launch) notFound();
  const trades = await getCachedCoinTrades(launch.id, launch.chainId, launch.scope);
  return <MarketClient id={launch.id} launch={launch} trades={trades} />;
}

async function resolveCoin(token: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return undefined;
  return getCachedCoinLaunch(token.toLowerCase()).catch(() => undefined);
}
