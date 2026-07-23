import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import "./premium-system.css";
import "./dashboard.css";
import "./docs.css";
import "./signal-system.css";
import "./nft-launchpad.css";
import "./nft-catalog.css";
import "./create-launch-menu.css";
import "./interface-refinement.css";
import { Providers } from "@/components/providers";
import { WalletButton } from "@/components/wallet-button";
import { RouteFeedback } from "@/components/route-feedback";
import { SideNav } from "@/components/side-nav";
import { siteUrl } from "@/lib/site-url";
import { NetworkSelector } from "@/components/network-selector";
import { Suspense } from "react";
import { ChainLink } from "@/components/chain-link";
import { NetworkIcon } from "@/components/network-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { CreateLaunchMenu } from "@/components/create-launch-menu";
import { BrandLaunchpadMenu } from "@/components/brand-launchpad-menu";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: "BlueFun",
  description: "Fair multichain token launches on Base, Robinhood Chain, Monad and Stable.",
  other: {
    "base:app_id": "6a594e1358aaa84e3d06752c"
  },
  icons: {
    icon: [{ url: "/brand/bluelogo.webp", type: "image/webp" }],
    apple: "/brand/bluelogo.webp"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#030303" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8ff" }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const maintenanceMode = process.env.SITE_MAINTENANCE_MODE === "true";

  if (maintenanceMode) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className="maintenance-body">
          <main className="maintenance-page">
            <section className="maintenance-card" aria-labelledby="maintenance-title">
              <div className="maintenance-brand">
                <span><Image src="/brand/bluelogo.webp" alt="" width={40} height={40} priority /></span>
                <div><strong>BlueFun</strong><small>Base + Robinhood + Monad + Stable</small></div>
              </div>
              <div className="maintenance-status"><i /> Scheduled pause</div>
              <h1 id="maintenance-title">The launch desk is taking a short break.</h1>
              <p>We are completing platform maintenance. Your tokens and onchain positions remain safe and available on their networks.</p>
              <div className="maintenance-network-row">
                <span><NetworkIcon chainId={8453} size={22} /> Base</span>
                <span><NetworkIcon chainId={4663} size={22} /> Robinhood</span>
                <span><NetworkIcon chainId={143} size={22} /> Monad</span>
                <span><NetworkIcon chainId={988} size={22} /> Stable</span>
              </div>
              <footer>
                <span>Onchain contracts continue to operate independently.</span>
                <a href="https://x.com/BluefunLaunch" target="_blank" rel="noreferrer">Status updates on X</a>
              </footer>
            </section>
          </main>
        </body>
      </html>
    );
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html:not([data-theme]),html:not([data-theme]) body{background:#030303;color-scheme:dark}` }} />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('bluefun-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='dark'?'#030303':'#f6f8ff'}catch(e){}})();` }} />
      </head>
      <body>
        <Providers>
          <RouteFeedback />
          <div className="shell">
            <aside className="sidebar">
              <div className="brand-launchpad-row">
                <Suspense fallback={<Link className="brand" href="/">BlueFun</Link>}><ChainLink className="brand" href="/">
                  <span className="brand-mark">
                    <Image src="/brand/bluelogo.webp" alt="" width={32} height={32} priority />
                  </span>
                  <span className="brand-wordmark"><strong>BlueFun</strong><small>onchain launch desk</small></span>
                </ChainLink></Suspense>
                <BrandLaunchpadMenu />
              </div>
              <Suspense fallback={null}><SideNav /></Suspense>
              <div className="sidebar-network-note">
                <span className="sidebar-network-icons"><NetworkIcon chainId={8453} size={25} /><NetworkIcon chainId={4663} size={25} /><NetworkIcon chainId={143} size={25} /></span>
                <span><strong>Multichain</strong><small>Base + Robinhood + Monad live</small></span>
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
                  <span className="topbar-live"><i />Protocol live</span>
                  <CreateLaunchMenu />
                  <Suspense fallback={null}><NetworkSelector /></Suspense>
                  <ThemeToggle />
                  <WalletButton />
                </div>
              </header>
              <main className="main">{children}</main>
              <footer className="site-footer">
                <span>© {new Date().getFullYear()} BlueFun</span>
                <nav aria-label="Footer"><Link href="/docs">Docs</Link><Link href="/risk">Risk</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav>
              </footer>
            </section>
            <Suspense fallback={null}><SideNav mobile /></Suspense>
          </div>
        </Providers>
      </body>
    </html>
  );
}
