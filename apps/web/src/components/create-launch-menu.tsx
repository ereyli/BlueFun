"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Coins, Images } from "lucide-react";

export function CreateLaunchMenu() {
  const pathname = usePathname();
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

  return <div className={`create-launch-menu ${open ? "open" : ""}`} ref={root}>
    <button aria-expanded={open} aria-haspopup="menu" className="button primary create-launch-trigger" onClick={() => setOpen((value) => !value)} type="button">
      <span>Create</span><ChevronDown aria-hidden="true"/>
    </button>
    {open ? <div aria-label="Create launch" className="create-launch-popover" role="menu">
      <span>CHOOSE LAUNCH TYPE</span>
      <Link href="/launch" role="menuitem"><i className="token"><Coins/></i><span><strong>Token Launch</strong><small>Create a token and onchain market</small></span></Link>
      <Link href="/nft/launch" role="menuitem"><i className="nft"><Images/></i><span><strong>NFT Launch</strong><small>Launch an edition or PFP collection</small></span></Link>
    </div> : null}
  </div>;
}
