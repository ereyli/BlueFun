import type { Metadata } from "next";
import { getAddress, isAddress } from "viem";
import { notFound } from "next/navigation";
import { getNFTCollections } from "@/lib/nft-collections";
import { siteUrl } from "@/lib/site-url";
import { NFTMintMarket } from "./[tokenId]/nft-mint-market";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection } = await params;
  if (!isAddress(collection)) return { title: "NFT Collection | BlueFun" };
  const address = getAddress(collection);
  const summary = (await getNFTCollections(200)).find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!summary) return { title: "NFT Collection | BlueFun" };
  const title = `${summary.name} (${summary.symbol}) | BlueFun NFT`;
  const description = `${summary.status} on Base · ${Number(summary.initialMinted).toLocaleString("en-US")} / ${Number(summary.initialSupply).toLocaleString("en-US")} minted · ${summary.standard}.`;
  const url = siteUrl(`/nft/${address}`);
  const image = siteUrl(`/api/nft/share-card?collection=${encodeURIComponent(address)}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "BlueFun", type: "website", images: [{ url: image, width: 1200, height: 630, alt: `${summary.name} collection stats` }] },
    twitter: { card: "summary_large_image", site: "@BluefunLaunch", creator: "@BluefunLaunch", title, description, images: [image] }
  };
}

export default async function NFTCollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!isAddress(collection)) notFound();
  const address = getAddress(collection);
  const summary = (await getNFTCollections()).find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!summary) notFound();
  return <NFTMintMarket collection={address} tokenId={1n} view="collection" standard={summary.standard === "ERC-721 PFP" ? "ERC721" : "ERC1155"} deployment={summary.deployment}/>;
}
