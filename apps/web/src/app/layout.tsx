import type { Metadata } from "next";
import Link from "next/link";
import { Rocket } from "lucide-react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { WalletButton } from "@/components/wallet-button";
import { RouteFeedback } from "@/components/route-feedback";
import { SideNav } from "@/components/side-nav";

export const metadata: Metadata = {
  title: "BlueFun",
  description: "Safe and fair B20 token launchpad for Base."
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
                <span className="brand-mark"><Rocket size={17} /></span>
                <span>BlueFun</span>
              </Link>
              <SideNav />
              <Link className="button primary wide" href="/launch">Create</Link>
            </aside>
            <section className="content">
              <header className="topbar">
                <div className="top-search">Search for coins, tickers and creators...</div>
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
