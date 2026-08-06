"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
      {links.map((link) => {
        const active = link.exact ? pathname === link.href || pathname === "/explore" : pathname.startsWith(link.href);
        return <Link aria-current={active ? "page" : undefined} href={link.href} key={link.href}>{link.label}</Link>;
      })}
    </nav>
  );
}
