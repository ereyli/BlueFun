"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function ChainLink({ children, className, href }: { children: React.ReactNode; className?: string; href: string }) {
  const chain = useSearchParams().get("chain");
  const target = chain ? `${href}?chain=${chain}` : href;
  return <Link className={className} href={target}>{children}</Link>;
}
