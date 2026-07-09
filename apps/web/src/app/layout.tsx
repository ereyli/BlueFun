import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/providers";
import { WalletButton } from "@/components/wallet-button";
import { RouteFeedback } from "@/components/route-feedback";
import { SideNav } from "@/components/side-nav";
import { siteUrl } from "@/lib/site-url";
import { NetworkSelector } from "@/components/network-selector";
import { Suspense } from "react";
import { ChainLink } from "@/components/chain-link";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: "BlueFun",
  description: "Fair multichain token launches on Base and Robinhood Chain.",
  icons: {
    icon: "/brand/favicon.png",
    apple: "/brand/apple-touch-icon.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f8ff"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <RouteFeedback />
          <div className="shell">
            <aside className="sidebar">
              <Suspense fallback={<Link className="brand" href="/">BlueFun</Link>}><ChainLink className="brand" href="/">
                <span className="brand-mark">
                  <Image src="/brand/funblue-icon.png" alt="" width={32} height={32} priority />
                </span>
                <span>BlueFun</span>
              </ChainLink></Suspense>
              <Suspense fallback={null}><SideNav /></Suspense>
              <Suspense fallback={<Link className="button primary wide" href="/launch">Create</Link>}><ChainLink className="button primary wide" href="/launch">Create</ChainLink></Suspense>
              <a className="sidebar-social-link" href="https://x.com/B20base" target="_blank" rel="noreferrer" aria-label="BlueFun on X">
                <span className="x-icon" aria-hidden="true">X</span>
                <span>@B20base</span>
              </a>
            </aside>
            <section className="content">
              <header className="topbar">
                <Link className="mobile-brand" href="/" aria-label="BlueFun home">
                  <Image src="/brand/funblue-icon.png" alt="" width={32} height={32} priority />
                </Link>
                <Suspense fallback={null}><NetworkSelector /></Suspense>
                <Suspense fallback={<Link className="button primary" href="/launch">Create</Link>}><ChainLink className="button primary" href="/launch">Create</ChainLink></Suspense>
                <WalletButton />
              </header>
              <main className="main">{children}</main>
            </section>
            <Suspense fallback={null}><SideNav mobile /></Suspense>
          </div>
        </Providers>
      </body>
    </html>
  );
}
