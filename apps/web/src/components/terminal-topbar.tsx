"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { ImagePlus, Rocket, Search } from "@/components/bluefun-icons";
import { BrandLaunchpadMenu } from "@/components/brand-launchpad-menu";
import { NetworkSelector } from "@/components/network-selector";
import { WalletButton } from "@/components/wallet-button";
import { SiteHeaderNav } from "@/components/site-header-nav";

type TopbarContext = {
  title: string;
  searchPlaceholder: string;
  searchTarget: string;
  actionHref: string;
  actionLabel: string;
  actionIcon: "collection" | "token";
};

function contextFor(pathname: string): TopbarContext {
  const nft = pathname.startsWith("/nft");
  if (pathname === "/launch") return tokenContext("Create Token");
  if (pathname === "/dashboard") return tokenContext("Portfolio");
  if (pathname === "/transparency") return tokenContext("BLUE");
  if (pathname === "/docs") return tokenContext("Documentation");
  if (pathname === "/risk") return tokenContext("Risk Disclosure");
  if (pathname === "/terms") return tokenContext("Terms");
  if (pathname === "/privacy") return tokenContext("Privacy");
  if (pathname.startsWith("/dex")) return {
    title: "BlueDEX",
    searchPlaceholder: "Open token by contract address",
    searchTarget: "/dex",
    actionHref: "/dex?tab=pool",
    actionLabel: "Add liquidity",
    actionIcon: "token"
  };
  if (pathname === "/nft/launch") return nftContext("NFT Creator Studio");
  if (pathname === "/nft/dashboard") return nftContext("NFT Portfolio");
  if (pathname === "/nft") return nftContext("NFT Markets");
  if (nft) return nftContext("Collection");
  return tokenContext("Markets");
}

function tokenContext(title: string): TopbarContext {
  return {
    title,
    searchPlaceholder: "Search token, ticker or address",
    searchTarget: "/",
    actionHref: "/launch",
    actionLabel: "Create token",
    actionIcon: "token"
  };
}

function nftContext(title: string): TopbarContext {
  return {
    title,
    searchPlaceholder: "Search collection, symbol or address",
    searchTarget: "/nft",
    actionHref: "/nft/launch",
    actionLabel: "Create collection",
    actionIcon: "collection"
  };
}

export function TerminalTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const context = contextFor(pathname);
  const [query, setQuery] = useState("");
  const isCreateScreen = pathname === context.actionHref;

  useEffect(() => setQuery(""), [pathname]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `${context.searchTarget}?q=${encodeURIComponent(value)}` : context.searchTarget);
  }

  return (
    <header className="topbar terminal-global-header">
      <Link className="mobile-brand" href="/" aria-label="B20 home"><Image src="/brand/bluelogo.webp" alt="B20" width={34} height={34} priority /></Link>
      <div className="terminal-page-identity">
        <Link className="terminal-home-link" href="/" aria-label="BlueFun token markets"><Image src="/brand/bluelogo.webp" alt="" width={34} height={34} priority /></Link>
        <BrandLaunchpadMenu />
        <h1 className="terminal-page-title">{context.title}</h1>
      </div>
      <SiteHeaderNav />
      <form className="terminal-global-search" onSubmit={submitSearch}>
        <button aria-label="Search markets" className="terminal-search-submit" type="submit"><Search size={16}/></button>
        <input aria-label={context.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} placeholder={context.searchPlaceholder} value={query}/>
        <kbd>/</kbd>
      </form>
      <Suspense fallback={<span className="terminal-network-placeholder"/>}><NetworkSelector /></Suspense>
      <Link aria-current={isCreateScreen ? "page" : undefined} className="button primary terminal-create-action" href={context.actionHref}>
        {context.actionIcon === "collection" ? <ImagePlus size={15}/> : <Rocket size={15}/>}
        {context.actionLabel}
        <b>+</b>
      </Link>
      <Suspense fallback={<span className="terminal-wallet-placeholder"/>}><WalletButton /></Suspense>
    </header>
  );
}
