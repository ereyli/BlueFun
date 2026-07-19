import { getAddress, isAddress } from "viem";
import { notFound } from "next/navigation";
import { getNFTCollections } from "@/lib/nft-collections";
import { NFTMintMarket } from "./[tokenId]/nft-mint-market";

export const dynamic = "force-dynamic";

export default async function NFTCollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  if (!isAddress(collection)) notFound();
  const address = getAddress(collection);
  const summary = (await getNFTCollections()).find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!summary) notFound();
  return <NFTMintMarket collection={address} tokenId={1n} view="collection" standard={summary.standard === "ERC-721 PFP" ? "ERC721" : "ERC1155"}/>;
}
