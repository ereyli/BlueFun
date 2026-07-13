import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import "./premium-system.css";
import { Providers } from "@/components/providers";
import { WalletButton } from "@/components/wallet-button";
import { RouteFeedback } from "@/components/route-feedback";
import { SideNav } from "@/components/side-nav";
import { siteUrl } from "@/lib/site-url";
import { NetworkSelector } from "@/components/network-selector";
import { Suspense } from "react";
import { ChainLink } from "@/components/chain-link";
import { NetworkIcon } from "@/components/network-icon";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: "BlueFun",
  description: "Fair multichain token launches on Base and Robinhood Chain.",
  icons: {
    icon: [{ url: "/brand/bluelogo.webp", type: "image/webp" }],
    apple: "/brand/bluelogo.webp"
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
                  <Image src="/brand/bluelogo.webp" alt="" width={32} height={32} priority />
                </span>
                <span>BlueFun</span>
              </ChainLink></Suspense>
              <Suspense fallback={null}><SideNav /></Suspense>
              <div className="sidebar-network-note">
                <span className="sidebar-network-icons"><NetworkIcon chainId={8453} size={25} /><NetworkIcon chainId={4663} size={25} /></span>
                <span><strong>Multichain</strong><small>Base + Robinhood live</small></span>
              </div>
              <a className="sidebar-social-link" href="https://x.com/BluefunLaunch" target="_blank" rel="noreferrer" aria-label="BlueFun on X">
                <span className="x-icon" aria-hidden="true">X</span>
                <span>@BluefunLaunch</span>
              </a>
            </aside>
            <section className="content">
              <header className="topbar">
                <Link className="mobile-brand" href="/" aria-label="BlueFun home">
                  <Image src="/brand/bluelogo.webp" alt="" width={32} height={32} priority />
                </Link>
                <div className="topbar-actions">
                  <Suspense fallback={<Link className="button primary" href="/launch">Create</Link>}><ChainLink className="button primary topbar-create" href="/launch">Create</ChainLink></Suspense>
                  <Suspense fallback={null}><NetworkSelector /></Suspense>
                  <WalletButton />
                </div>
              </header>
              <main className="main">{children}</main>
              <footer className="site-footer">
                <span>© {new Date().getFullYear()} BlueFun</span>
                <nav aria-label="Legal"><Link href="/risk">Risk</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav>
              </footer>
            </section>
            <Suspense fallback={null}><SideNav mobile /></Suspense>
          </div>
        </Providers>
      </body>
    </html>
  );
}
