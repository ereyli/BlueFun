"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Home, LayoutDashboard, Rocket, ShieldCheck } from "lucide-react";
import { chainSlugFromPath, namedChainParam } from "@/lib/chain-slug";

const items = [
  { href: "/", label: "Explore", icon: Home },
  { href: "/launch", label: "Create", icon: Rocket },
  { href: "/transparency", label: "BLUE", icon: ShieldCheck },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/docs", label: "Docs", icon: BookOpen, desktopOnly: true }
];

export function SideNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const chain = namedChainParam(useSearchParams().get("chain")) || chainSlugFromPath(pathname);

  return (
    <nav className={mobile ? "bottom-nav" : "side-nav"} aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
      {items.filter((item) => !mobile || !item.desktopOnly).map((item, index) => {
        const Icon = item.icon;
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link aria-current={active ? "page" : undefined} href={chain ? `${item.href}?chain=${chain}` : item.href} key={item.label}>
            <span className="nav-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <Icon className="nav-icon" aria-hidden="true" size={mobile ? 22 : 18} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
