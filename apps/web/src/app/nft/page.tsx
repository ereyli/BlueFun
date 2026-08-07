import Link from "next/link";
import { ArrowRight, ImagePlus } from "@/components/bluefun-icons";
import { NFTCollectionDirectory, NFTLiveMints } from "./nft-collection-directory";
import { getNFTCollections, type NFTCollectionSummary } from "@/lib/nft-collections";
import { uiPreviewEnabled } from "@/lib/ui-preview-data";

export const dynamic = "force-dynamic";

export default async function NFTPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q || "";
  const collections = uiPreviewEnabled() ? previewNFTCollections : await getNFTCollections(200);
  const live = collections.filter((collection) => collection.status === "Live").length;
  const creators = new Set(collections.map((collection) => collection.creator.toLowerCase())).size;
  return <div className="nft-home nft-directory-home">
    <section className="nft-directory-hero">
      <div><span><i/>NFT MARKETS · BASE</span><h1>Discover. Mint. Collect.</h1><p>Primary drops and verified collections in one focused market.</p><div><Link className="button primary" href="/nft/launch"><ImagePlus/>Create collection</Link><a className="button" href="#live-mints">Live mints <ArrowRight/></a></div></div>
      <dl><div><dt>COLLECTIONS</dt><dd>{collections.length}</dd></div><div><dt>LIVE MINTS</dt><dd>{live}</dd></div><div><dt>CREATORS</dt><dd>{creators}</dd></div><div><dt>NETWORK</dt><dd>Base</dd></div></dl>
    </section>
    <NFTLiveMints collections={collections}/>
    <div id="collections"><NFTCollectionDirectory collections={collections} initialQuery={query}/></div>
  </div>;
}

const previewNFTCollections: NFTCollectionSummary[] = [
  previewCollection("01", "Blue Origins", "ORIGIN", "/brand/nft-launchpad.png", "A focused genesis edition for the B20 ecosystem.", "864", "1200", "0.02", "ERC-1155"),
  previewCollection("02", "Basebara Society", "BARA", "/launch-assets/basebara.png", "Character-led collectibles built for the Base community.", "421", "888", "0.035", "ERC-721 PFP"),
  previewCollection("03", "Blue Signals", "SIGNAL", "/base-app/professional/app-thumbnail.jpg", "Limited visual signals from the onchain market desk.", "303", "500", "0.015", "ERC-1155"),
  previewCollection("04", "B20 Operators", "OPS", "/base-app/thumbnail.jpg", "Operator profiles for builders, traders and collectors.", "179", "420", "0.01", "ERC-721 PFP"),
  previewCollection("05", "Arc Frequencies", "ARC", "/base-app/screenshot-2.png", "An experimental multi-art collection for the Arc network.", "92", "300", "0.008", "ERC-1155"),
  previewCollection("06", "Liquid Blue", "LIQUID", "/base-app/screenshot-3.png", "Dynamic artwork inspired by liquidity and market flow.", "67", "250", "0.012", "ERC-1155")
];

function previewCollection(
  id: string,
  name: string,
  symbol: string,
  imageUrl: string,
  description: string,
  initialMinted: string,
  initialSupply: string,
  mintPriceEth: string,
  standard: NFTCollectionSummary["standard"]
): NFTCollectionSummary {
  const suffix = id.padStart(40, "0");
  return {
    id: `preview-${id}`,
    address: `0x${suffix}` as `0x${string}`,
    creator: "0x7a3f10000000000000000000000000000000952f",
    factory: "0xb200000000000000000000000000000000000020",
    deployment: "current",
    name,
    symbol,
    imageUrl,
    description,
    itemCount: standard === "ERC-721 PFP" ? Number(initialSupply) : 1,
    initialSupply,
    initialMinted,
    royaltyPercent: "5",
    phaseId: id,
    mintPriceEth,
    access: "Public",
    status: "Live",
    isFree: false,
    standard
  };
}
