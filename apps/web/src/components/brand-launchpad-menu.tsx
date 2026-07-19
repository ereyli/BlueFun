"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Coins, Images } from "lucide-react";

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
      <i className={nftMode ? "nft" : "token"}>{nftMode ? <Images aria-hidden="true" /> : <Coins aria-hidden="true" />}</i>
      <span>{nftMode ? "NFT" : "Token"}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {open ? <div aria-label="Launchpads" className="brand-launchpad-popover" role="menu">
      <div className="brand-launchpad-popover-head"><span>Switch launchpad</span></div>
      <Link className={!nftMode ? "active" : undefined} href="/" role="menuitem">
        <i className="token"><Coins aria-hidden="true"/></i>
        <span><strong>Token Launchpad</strong><small>Launch and trade tokens</small></span>
        <em>{!nftMode ? <><Check aria-hidden="true"/>Active</> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
      <Link className={nftMode ? "active" : undefined} href="/nft" role="menuitem">
        <i className="nft"><Images aria-hidden="true"/></i>
        <span><strong>NFT Launchpad</strong><small>Create, mint and trade NFTs</small></span>
        <em>{nftMode ? <><Check aria-hidden="true"/>Active</> : <ArrowUpRight aria-hidden="true"/>}</em>
      </Link>
    </div> : null}
  </div>;
}
