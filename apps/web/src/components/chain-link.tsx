"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { chainSlugFromPath, namedChainParam } from "@/lib/chain-slug";

type ChainLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

export function ChainLink({ children, href, ...props }: ChainLinkProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const chain = namedChainParam(searchParams.get("chain")) || chainSlugFromPath(pathname);
  const separator = href.includes("?") ? "&" : "?";
  const target = chain ? `${href}${separator}chain=${chain}` : href;
  return <Link {...props} href={target}>{children}</Link>;
}
