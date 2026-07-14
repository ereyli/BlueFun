"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, Rocket, ShieldCheck } from "lucide-react";
import { chainSlugFromPath, namedChainParam } from "@/lib/chain-slug";

const items = [
  { href: "/", label: "Explore", icon: Home },
  { href: "/transparency", label: "BLUE", icon: ShieldCheck },
  { href: "/launch", label: "Create", icon: Rocket }
];

export function SideNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const chain = namedChainParam(useSearchParams().get("chain")) || chainSlugFromPath(pathname);

  return (
    <nav className={mobile ? "bottom-nav" : "side-nav"} aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link aria-current={active ? "page" : undefined} href={chain ? `${item.href}?chain=${chain}` : item.href} key={item.label}>
            <Icon aria-hidden="true" size={mobile ? 22 : 20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
