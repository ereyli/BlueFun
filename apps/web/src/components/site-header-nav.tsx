"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { ChainLink } from "@/components/chain-link";

const links: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/", label: "Markets", exact: true },
  { href: "/transparency", label: "BLUE" },
  { href: "/dashboard", label: "Portfolio" },
  { href: "/docs", label: "Docs" }
];

export function SiteHeaderNav({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={`site-header-nav${compact ? " compact" : ""}`} aria-label="Primary navigation">
      <Suspense fallback={null}>
        {links.map((link) => {
          const active = link.exact ? pathname === link.href || pathname === "/explore" : pathname.startsWith(link.href);
          return <ChainLink aria-current={active ? "page" : undefined} href={link.href} key={link.href}>{link.label}</ChainLink>;
        })}
      </Suspense>
    </nav>
  );
}
