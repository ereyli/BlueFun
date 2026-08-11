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
import "./token-share.css";
import "./bluefun-experience.css";
import "./terminal-system.css";
import "./launch-refinement.css";
import "./minimal-market.css";
import "./nft-modern.css";
import "./bluedex.css";
import "./shell-theme-refinement.css";
import "./editorial-simplicity.css";
import { Providers } from "@/components/providers";
import { NavigationRecovery } from "@/components/navigation-recovery";
import { SideNav } from "@/components/side-nav";
import { siteUrl } from "@/lib/site-url";
import { Suspense } from "react";
import { ChainLink } from "@/components/chain-link";
import { NetworkIcon } from "@/components/network-icon";
import { TerminalTopbar } from "@/components/terminal-topbar";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: "B20",
  description: "The multichain terminal for token launches, locked liquidity, trading and NFT markets.",
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
                <div><strong>B20</strong><small>Base + Robinhood + Monad + Stable</small></div>
              </div>
              <div className="maintenance-status"><i /> Scheduled pause</div>
              <h1 id="maintenance-title">The launch desk is taking a short break.</h1>
              <p>We are completing platform maintenance. Your tokens and onchain positions remain safe and available on their networks.</p>
              <div className="maintenance-network-row">
                <span><NetworkIcon chainId={8453} size={22} /> Base</span>
                <span><NetworkIcon chainId={4663} size={22} /> Robinhood</span>
                <span><NetworkIcon chainId={143} size={22} /> Monad</span>
                <span><NetworkIcon chainId={988} size={22} /> Stable</span>
                <span><NetworkIcon chainId={5042} size={22} /> Arc</span>
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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `html,body{background:#090b10;color-scheme:dark}` }} />
      </head>
      <body>
        <Providers>
          <NavigationRecovery />
          <div className="shell">
            <aside className="sidebar">
              <div className="brand-launchpad-row">
                <Suspense fallback={<Link className="brand" href="/" aria-label="B20 markets"><Image className="terminal-brand-logo" src="/brand/bluelogo.webp" alt="B20" width={46} height={46} priority /></Link>}><ChainLink className="brand" href="/" aria-label="B20 markets">
                  <Image className="terminal-brand-logo" src="/brand/bluelogo.webp" alt="B20" width={46} height={46} priority />
                  <span className="brand-wordmark"><strong>B20</strong><small>onchain terminal</small></span>
                </ChainLink></Suspense>
              </div>
              <Suspense fallback={null}><SideNav /></Suspense>
              <div className="sidebar-footer-tools">
                <ThemeToggle />
                <a className="sidebar-social-link" href="https://x.com/BluefunLaunch" target="_blank" rel="noreferrer" aria-label="B20 on X">
                  <span className="x-icon" aria-hidden="true">X</span>
                  <span>@BluefunLaunch</span>
                </a>
              </div>
            </aside>
            <section className="content">
              <TerminalTopbar />
              <main className="main">{children}</main>
              <footer className="site-footer">
                <span>© {new Date().getFullYear()} B20</span>
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
