import { getAddress, isAddress } from "viem";
import { notFound } from "next/navigation";
import { getNFTCollections } from "@/lib/nft-collections";
import { NFTMintMarket } from "./nft-mint-market";

export default async function NFTItemPage({ params }: { params: Promise<{ collection: string; tokenId: string }> }) {
  const { collection, tokenId } = await params;
  if (!isAddress(collection) || !/^\d+$/.test(tokenId) || BigInt(tokenId) < 1n) notFound();
  const address = getAddress(collection);
  const summary = (await getNFTCollections()).find((item) => item.address.toLowerCase() === address.toLowerCase());
  return <NFTMintMarket collection={address} tokenId={BigInt(tokenId)} standard={summary ? summary.standard === "ERC-721 PFP" ? "ERC721" : "ERC1155" : undefined} deployment={summary?.deployment}/>;
}
