"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { chainSlugFromPath, namedChainParam } from "@/lib/chain-slug";

export function ChainLink({ children, className, href }: { children: React.ReactNode; className?: string; href: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const chain = namedChainParam(searchParams.get("chain")) || chainSlugFromPath(pathname);
  const target = chain ? `${href}?chain=${chain}` : href;
  return <Link className={className} href={target}>{children}</Link>;
}
