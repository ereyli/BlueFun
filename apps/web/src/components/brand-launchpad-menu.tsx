"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ArrowUpRight, Check, ChevronDown, Coins, Images } from "@/components/bluefun-icons";

function ProductIcon({ product, size = 22 }: { product: "token" | "nft" | "dex"; size?: number }) {
  if (product === "nft") return <Images aria-hidden="true" size={size}/>;
  if (product === "dex") return <ArrowDownUp aria-hidden="true" size={size}/>;
  return <Coins aria-hidden="true" size={size}/>;
}

export function BrandLaunchpadMenu() {
  const pathname = usePathname();
  const nftMode = pathname.startsWith("/nft");
  const dexMode = pathname.startsWith("/dex");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className={`brand-launchpad-menu ${open ? "open" : ""}`} ref={root}>
    <button aria-expanded={open} aria-haspopup="menu" aria-label="Choose launchpad" onClick={() => setOpen((value) => !value)} title="Choose launchpad" type="button">
      <span className={`launchpad-product-mark ${nftMode ? "nft" : dexMode ? "dex" : "token"}`}>
        <ProductIcon product={nftMode ? "nft" : dexMode ? "dex" : "token"}/>
      </span>
      <span>{nftMode ? "NFTs" : dexMode ? "DEX" : "Tokens"}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {open ? <div aria-label="Launchpads" className="brand-launchpad-popover" role="menu">
      <div className="brand-launchpad-popover-head"><span>Choose product</span><small>Launch, trade or collect</small></div>
      <Link className={!nftMode && !dexMode ? "active" : undefined} href="/" role="menuitem">
        <span className="launchpad-product-preview token"><ProductIcon product="token"/></span>
        <span><strong>Token markets</strong><small>Launch, discover and trade tokens</small></span>
        <em>{!nftMode && !dexMode ? <Check aria-label="Current product"/> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
      <Link className={nftMode ? "active" : undefined} href="/nft" role="menuitem">
        <span className="launchpad-product-preview nft"><ProductIcon product="nft"/></span>
        <span><strong>NFT markets</strong><small>Create, mint and trade collections</small></span>
        <em>{nftMode ? <Check aria-label="Current launchpad"/> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
      <Link className={dexMode ? "active" : undefined} href="/dex" role="menuitem">
        <span className="launchpad-product-preview dex"><ProductIcon product="dex"/></span>
        <span><strong>BlueDEX</strong><small>Swap tokens and manage liquidity</small></span>
        <em>{dexMode ? <Check aria-label="Current product"/> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
    </div> : null}
  </div>;
}
