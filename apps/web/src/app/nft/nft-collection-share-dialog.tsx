"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";

type ShareDialogProps = {
  collection: string;
  name: string;
  symbol: string;
  status: string;
  minted: bigint;
  supply: bigint;
  floor: string;
  volume: string;
  owners: number;
  open: boolean;
  onClose: () => void;
};

export function NFTCollectionShareDialog(props: ShareDialogProps) {
  const { onClose, open } = props;
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const cacheKey = Math.floor(Date.now() / 30_000);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    document.body.classList.add("nft-dialog-open");
    return () => { document.removeEventListener("keydown", close); document.body.classList.remove("nft-dialog-open"); };
  }, [open, onClose]);

  const collectionUrl = origin ? `${origin}/nft/${props.collection}` : "";
  const shareText = useMemo(() => {
    const mint = `${props.minted.toLocaleString("en-US")} / ${props.supply.toLocaleString("en-US")} minted`;
    const market = props.floor === "—" ? `${props.volume} total volume` : `${props.floor} floor`;
    return `${props.name} (${props.symbol}) on BlueFun\n${props.status} · ${mint} · ${market}\nExplore the collection on Base 👇`;
  }, [props.floor, props.minted, props.name, props.status, props.supply, props.symbol, props.volume]);
  const xUrl = collectionUrl ? `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(collectionUrl)}` : "#";
  const cardUrl = `/api/nft/share-card?collection=${encodeURIComponent(props.collection)}&v=${cacheKey}`;

  async function copyLink() {
    if (!collectionUrl) return;
    await navigator.clipboard.writeText(collectionUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!open) return null;
  return <div className="nft-share-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-labelledby="nft-share-title" aria-modal="true" className="nft-share-dialog" role="dialog">
      <header><div><span><Share2/></span><div><small>COLLECTION MEDIA</small><h2 id="nft-share-title">Share collection</h2></div></div><button aria-label="Close share dialog" onClick={onClose}><X/></button></header>
      <div className="nft-share-preview"><img alt={`${props.name} share card`} src={cardUrl}/></div>
      <div className="nft-share-meta"><span><i/>Live collection data</span><p>The image and X preview use the latest indexed floor, volume, owners and mint progress.</p></div>
      <footer><button className="button nft-copy-link" onClick={() => void copyLink()}>{copied ? <Check/> : <Copy/>}{copied ? "Copied" : "Copy link"}</button><a className="button primary nft-share-x" href={xUrl} target="_blank" rel="noreferrer"><b>𝕏</b>Share on X</a></footer>
    </section>
  </div>;
}
