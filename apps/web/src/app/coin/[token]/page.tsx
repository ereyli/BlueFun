import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { MarketClient } from "@/app/launch/[id]/market-client";
import { getDbLaunchByToken, getDbTrades } from "@/lib/db-launches";
import { getDeployedLaunches, getLaunchTrades } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { siteUrl } from "@/lib/site-url";
import { tokenPath } from "@/lib/token-url";
import { getArcOnchainLaunchByToken } from "@/lib/arc-launches";
import { findUiPreviewLaunch, isUiPreviewLaunch, uiPreviewEnabled, uiPreviewTrades } from "@/lib/ui-preview-data";
import { SolanaMarket } from "@/components/solana-market";
import { chainIdFromParam, type SupportedChainId } from "@/lib/chain-slug";

export const revalidate = 15;

type CoinParams = { params: Promise<{ token: string }>; searchParams: Promise<{ chain?: string }> };

const getCachedCoinLaunch = unstable_cache(
  async (token: string, chainId?: SupportedChainId) => {
    if (chainId) {
      const indexed = await getDbLaunchByToken(token, chainId);
      if (indexed || chainId === 101) return indexed;
      if (chainId === 5042) return getArcOnchainLaunchByToken(token);
      if (chainId === 8453) return getDeployedLaunches().then((launches) => launches.find((launch) => launch.token.toLowerCase() === token.toLowerCase()));
      if (chainId === 4663) return getRobinhoodLaunches().then((launches) => launches.find((launch) => launch.token.toLowerCase() === token.toLowerCase()));
      return undefined;
    }
    const indexed = await Promise.all([8453, 4663, 143, 988, 5042, 101].map((chainId) => getDbLaunchByToken(token, chainId)));
    const indexedMatch = indexed.find(Boolean);
    if (indexedMatch) return indexedMatch;

    const [base, robinhood, arc] = await Promise.all([
      getDeployedLaunches(),
      getRobinhoodLaunches(),
      getArcOnchainLaunchByToken(token)
    ]);
    return arc ?? [...base, ...robinhood].find((launch) => launch.token.toLowerCase() === token.toLowerCase());
  },
  ["market-coin-v3"],
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

export async function generateMetadata({ params, searchParams }: CoinParams): Promise<Metadata> {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const launch = await resolveCoin(token, query.chain);
  if (!launch) return { title: "B20 Market", description: "Trade token launches on B20." };

  const title = `${launch.name} ($${launch.symbol}) on B20`;
  const description = launch.description || `Trade $${launch.symbol} on the B20 bonding curve.`;
  const url = siteUrl(tokenPath(launch));
  // X caches failed image fetches independently from the page card. Bump this
  // version when the card renderer changes so social crawlers fetch a fresh PNG.
  const image = siteUrl(`/api/token/share-card?chain=${launch.chainId}&token=${encodeURIComponent(launch.token)}&v=20260725-3`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "B20", type: "website", images: [{ url: image, type: "image/png", width: 1200, height: 630, alt: `${launch.name} social share card` }] },
    twitter: { card: "summary_large_image", site: "@BluefunLaunch", creator: "@BluefunLaunch", title, description, images: [{ url: image, alt: `${launch.name} social share card` }] }
  };
}

export default async function CoinMarketPage({ params, searchParams }: CoinParams) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const launch = await resolveCoin(token, query.chain);
  if (!launch) notFound();
  if (launch.chainId === 101) return <SolanaMarket launch={launch} />;
  const trades = isUiPreviewLaunch(launch) ? uiPreviewTrades : await getCachedCoinTrades(launch.id, launch.chainId, launch.scope);
  return <MarketClient id={launch.id} launch={launch} trades={trades} />;
}

async function resolveCoin(token: string, chain?: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token)) return undefined;
  if (uiPreviewEnabled()) {
    const preview = findUiPreviewLaunch(token);
    if (preview) return preview;
  }
  const chainId = chain ? chainIdFromParam(chain) : undefined;
  return getCachedCoinLaunch(token.startsWith("0x") ? token.toLowerCase() : token, chainId).catch(() => undefined);
}
