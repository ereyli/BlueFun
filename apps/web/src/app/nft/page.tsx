import Link from "next/link";
import { ArrowRight, ImagePlus } from "lucide-react";
import { NFTCollectionDirectory, NFTLiveMints } from "./nft-collection-directory";
import { getNFTCollections } from "@/lib/nft-collections";

export const dynamic = "force-dynamic";

export default async function NFTPage() {
  const collections = await getNFTCollections(200);
  const live = collections.filter((collection) => collection.status === "Live").length;
  const creators = new Set(collections.map((collection) => collection.creator.toLowerCase())).size;
  return <div className="nft-home nft-directory-home">
    <section className="nft-directory-hero">
      <div><span><i/>BLUEFUN NFT · BASE</span><h1>Mint. Collect. Trade.</h1><p>Live primary drops and secondary collections now have their own focused workspaces.</p><div><Link className="button primary" href="/nft/launch"><ImagePlus/>Create collection</Link><a className="button" href="#live-mints">Live mints <ArrowRight/></a></div></div>
      <dl><div><dt>COLLECTIONS</dt><dd>{collections.length}</dd></div><div><dt>LIVE MINTS</dt><dd>{live}</dd></div><div><dt>CREATORS</dt><dd>{creators}</dd></div><div><dt>NETWORK</dt><dd>Base</dd></div></dl>
    </section>
    <NFTLiveMints collections={collections}/>
    <div id="collections"><NFTCollectionDirectory collections={collections}/></div>
  </div>;
}
