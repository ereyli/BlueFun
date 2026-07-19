"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Home, ImagePlus, Images, LayoutDashboard, ShieldCheck, WalletCards, type LucideIcon } from "lucide-react";
import { chainSlugFromPath, namedChainParam } from "@/lib/chain-slug";

type NavItem = { href: string; label: string; icon: LucideIcon; shortLabel?: string; desktopOnly?: boolean; exact?: boolean };

const tokenItems: NavItem[] = [
  { href: "/", label: "Explore", icon: Home },
  { href: "/launch", label: "Create Token", shortLabel: "Create", icon: ImagePlus },
  { href: "/transparency", label: "BLUE", icon: ShieldCheck },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/docs", label: "Docs", icon: BookOpen, desktopOnly: true }
];

const nftItems: NavItem[] = [
  { href: "/nft", label: "Explore Collections", shortLabel: "Explore", icon: Images, exact: true },
  { href: "/nft/launch", label: "Create Collection", shortLabel: "Create", icon: ImagePlus },
  { href: "/nft/dashboard", label: "My NFTs", shortLabel: "My NFTs", icon: WalletCards }
];

export function SideNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const chain = namedChainParam(useSearchParams().get("chain")) || chainSlugFromPath(pathname);
  const nftMode = pathname.startsWith("/nft");
  const items = nftMode ? nftItems : tokenItems;

  return (
    <nav className={`${mobile ? "bottom-nav" : "side-nav"} ${nftMode ? "nft-navigation" : "token-navigation"}`} aria-label={mobile ? `${nftMode ? "NFT" : "Token"} mobile navigation` : `${nftMode ? "NFT" : "Token"} launchpad navigation`}>
      {items.filter((item) => !mobile || !item.desktopOnly).map((item, index) => {
        const Icon = item.icon;
        const route = item.href.split("#")[0];
        const active = item.exact || route === "/" ? pathname === route : pathname.startsWith(route);
        const href = nftMode || !chain ? item.href : `${item.href}?chain=${chain}`;
        return (
          <Link aria-current={active ? "page" : undefined} href={href} key={item.label}>
            <span className="nav-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <Icon className="nav-icon" aria-hidden="true" size={mobile ? 22 : 18} />
            <span>{mobile && item.shortLabel ? item.shortLabel : item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
