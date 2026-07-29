import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getDbLaunchByTokenSuffix } from "@/lib/db-launches";
import { getDeployedLaunches } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";
import { siteUrl } from "@/lib/site-url";
import { tokenPath, tokenSuffixFromSlug } from "@/lib/token-url";
import { getArcOnchainLaunchBySuffix } from "@/lib/arc-launches";

export const revalidate = 15;

type TokenParams = { params: Promise<{ chain: string; slug: string }> };

const getCachedLaunchBySuffix = unstable_cache(
  async (suffix: string, chainId: number) => {
    const indexed = await getDbLaunchByTokenSuffix(suffix, chainId);
    if (indexed) return indexed;
    if (chainId === 5042) return getArcOnchainLaunchBySuffix(suffix);
    if (chainId === 143 || chainId === 988) return undefined;
    const launches = chainId === 4663 ? await getRobinhoodLaunches() : await getDeployedLaunches();
    const matches = launches.filter((launch) => launch.token.toLowerCase().endsWith(suffix.toLowerCase()));
    return matches.length === 1 ? matches[0] : undefined;
  },
  ["market-launch-token-v2"],
  { revalidate: 15 }
);

export async function generateMetadata({ params }: TokenParams): Promise<Metadata> {
  const { chain, slug } = await params;
  const launch = await resolveTokenLaunch(chain, slug);
  if (!launch) return { title: "BlueFun Market", description: "Trade token launches on BlueFun." };

  const title = `${launch.name} ($${launch.symbol}) on BlueFun`;
  const description = launch.description || `Trade $${launch.symbol} on the BlueFun bonding curve.`;
  const url = siteUrl(tokenPath(launch));
  const image = siteUrl(`/api/token/share-card?chain=${launch.chainId}&token=${encodeURIComponent(launch.token)}&v=20260725-3`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "BlueFun", type: "website", images: [{ url: image, type: "image/png", width: 1200, height: 630, alt: `${launch.name} social share card` }] },
    twitter: { card: "summary_large_image", site: "@BluefunLaunch", creator: "@BluefunLaunch", title, description, images: [{ url: image, alt: `${launch.name} social share card` }] }
  };
}

export default async function TokenMarketPage({ params }: TokenParams) {
  const { chain, slug } = await params;
  const launch = await resolveTokenLaunch(chain, slug);
  if (!launch) notFound();
  permanentRedirect(tokenPath(launch));
}

async function resolveTokenLaunch(chain: string, slug: string) {
  if (chain !== "base" && chain !== "robinhood" && chain !== "monad" && chain !== "stable" && chain !== "arc") return undefined;
  const suffix = tokenSuffixFromSlug(slug);
  if (!suffix) return undefined;
  return getCachedLaunchBySuffix(suffix, chainIdFromParam(chain)).catch(() => undefined);
}
