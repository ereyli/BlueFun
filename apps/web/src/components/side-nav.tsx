"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Rocket, ShieldCheck } from "lucide-react";

const items = [
  { href: "/", label: "Explore", icon: Home },
  { href: "/launch", label: "Create", icon: Rocket },
  { href: "/graduation", label: "Graduation", icon: ShieldCheck }
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="side-nav" aria-label="Main navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link aria-current={active ? "page" : undefined} href={item.href} key={item.label}>
            <Icon size={20} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
