"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";

export function BrandLaunchpadMenu() {
  const pathname = usePathname();
  const nftMode = pathname.startsWith("/nft");
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
      <span className={`launchpad-product-mark ${nftMode ? "nft" : "token"}`}>
        <Image alt="" height={30} src={nftMode ? "/brand/nft-launchpad.png" : "/brand/bluelogo.webp"} width={30}/>
      </span>
      <span>{nftMode ? "NFT" : "Token"}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {open ? <div aria-label="Launchpads" className="brand-launchpad-popover" role="menu">
      <Link className={!nftMode ? "active" : undefined} href="/" role="menuitem">
        <span className="launchpad-product-preview token"><Image alt="" height={34} src="/brand/bluelogo.webp" width={34}/></span>
        <span><strong>Token Launchpad</strong><small>Launch and trade tokens</small></span>
        <em>{!nftMode ? <Check aria-label="Current launchpad"/> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
      <Link className={nftMode ? "active" : undefined} href="/nft" role="menuitem">
        <span className="launchpad-product-preview nft"><Image alt="" height={34} src="/brand/nft-launchpad.png" width={34}/></span>
        <span><strong>NFT Launchpad</strong><small>Create, mint and trade NFTs</small></span>
        <em>{nftMode ? <Check aria-label="Current launchpad"/> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
    </div> : null}
  </div>;
}
