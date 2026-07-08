import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/providers";
import { WalletButton } from "@/components/wallet-button";
import { RouteFeedback } from "@/components/route-feedback";
import { SideNav } from "@/components/side-nav";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: "BlueFun",
  description: "Safe and fair B20 token launchpad for Base.",
  icons: {
    icon: "/brand/favicon.png",
    apple: "/brand/apple-touch-icon.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <RouteFeedback />
          <div className="shell">
            <aside className="sidebar">
              <Link className="brand" href="/">
                <span className="brand-mark">
                  <Image src="/brand/funblue-icon.png" alt="" width={32} height={32} priority />
                </span>
                <span>BlueFun</span>
              </Link>
              <SideNav />
              <Link className="button primary wide" href="/launch">Create</Link>
              <a className="sidebar-social-link" href="https://x.com/B20base" target="_blank" rel="noreferrer" aria-label="BlueFun on X">
                <span className="x-icon" aria-hidden="true">X</span>
                <span>@B20base</span>
              </a>
            </aside>
            <section className="content">
              <header className="topbar">
                <Link className="button primary" href="/launch">Create</Link>
                <WalletButton />
              </header>
              <main className="main">{children}</main>
            </section>
          </div>
        </Providers>
      </body>
    </html>
  );
}
