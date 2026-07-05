"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Grid2X2, Rocket, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { compactUsd, parseDisplayAmount } from "@/lib/market-math";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";

type Filter = "Live" | "New" | "Ready" | "Graduated" | "Safe" | "Progress";

export function LaunchExplorer({ launches }: { launches: DeployedLaunch[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("Live");
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const interval = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 6_000);
    return () => window.clearInterval(interval);
  }, [router]);

  useEffect(() => {
    let active = true;
    async function loadEthPrice() {
      try {
        const response = await fetch("/api/eth-price", { cache: "no-store" });
        const payload = await response.json() as { ethUsd?: number | null };
        if (active && payload.ethUsd) setEthUsd(payload.ethUsd);
      } catch {
        if (active) setEthUsd(null);
      }
    }
    loadEthPrice();
    const interval = window.setInterval(loadEthPrice, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const filteredLaunches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...launches].sort((a, b) => {
      if (filter === "Progress") return b.progress - a.progress;
      return Number(b.id) - Number(a.id);
    });

    return sorted.filter((launch) => {
      const matchesQuery = !normalizedQuery
        || launch.name.toLowerCase().includes(normalizedQuery)
        || launch.symbol.toLowerCase().includes(normalizedQuery)
        || launch.token.toLowerCase().includes(normalizedQuery)
        || launch.creator.toLowerCase().includes(normalizedQuery);

      if (!matchesQuery) return false;
      if (filter === "New") return true;
      if (filter === "Safe") return launch.risk === "Adminless" || launch.risk === "B20 gated";
      if (filter === "Progress") return true;
      return launch.status === filter;
    });
  }, [filter, launches, query]);

  return (
    <section className="explorer-shell">
      <div className="hero explorer-hero">
        <div className="explorer-title">
          <h1>Live B20 launches</h1>
          <span className="pill">Base Sepolia</span>
        </div>
        <div className={isPending ? "live-sync syncing" : "live-sync"}>
          <span className="dot green" />
          {isPending ? "Syncing" : "Live sync"}
        </div>
        <div className="searchbar">
          <Search size={18} color="var(--blue)" />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search coins, tickers, creators or addresses..."
            value={query}
          />
        </div>
      </div>

      <div className="explore-controls">
        <div className="feed-tabs" role="tablist" aria-label="Launch filters">
          <FilterButton active={filter === "Live"} onClick={() => setFilter("Live")}><Sparkles size={14} />Live</FilterButton>
          <FilterButton active={filter === "New"} onClick={() => setFilter("New")}>New</FilterButton>
          <FilterButton active={filter === "Ready"} onClick={() => setFilter("Ready")}>Ready</FilterButton>
          <FilterButton active={filter === "Graduated"} onClick={() => setFilter("Graduated")}>Graduated</FilterButton>
          <FilterButton active={filter === "Safe"} onClick={() => setFilter("Safe")}><ShieldCheck size={14} />Safe</FilterButton>
          <FilterButton active={filter === "Progress"} onClick={() => setFilter("Progress")}>Progress</FilterButton>
        </div>
        <div className="view-controls">
          <button className="icon-control" type="button" aria-label="Open filters"><SlidersHorizontal size={17} /></button>
          <button className="feed-tab active" type="button"><Grid2X2 size={15} />Grid</button>
          <button className="icon-control" type="button" aria-label="Open display settings"><Settings size={17} /></button>
        </div>
      </div>

      {filteredLaunches.length === 0 ? (
        <div className="empty">
          {launches.length === 0 ? "No live launches yet. New launches appear here automatically." : "No launches match this view."}
        </div>
      ) : (
        <div className="token-grid">
          {filteredLaunches.map((launch, index) => (
            <Link className="token-card" href={`/launch/${launch.id}`} key={`${launch.id}-${launch.token}`}>
              <div className={index === 0 ? "token-art hot" : "token-art"}>
                {launch.imageURI ? (
                  <img className="token-image" src={ipfsToGatewayUrl(launch.imageURI)} alt={launch.name} />
                ) : (
                  <>
                    <div className="token-symbol-art">{launch.symbol.slice(0, 4)}</div>
                    <div className="spark" />
                  </>
                )}
              </div>
              <div>
                <div className="token-card-head">
                  <div>
                    <div className="token-title">{launch.name}</div>
                    <div className="token-symbol">${launch.symbol}</div>
                  </div>
                  <span className={launch.status === "Live" ? "token-status live" : "token-status"}>{launch.status}</span>
                </div>
                <div className="token-money">{formatUsdFromEthText(launch.marketCap, ethUsd)} <span>MC</span></div>
                <div className="token-mini-grid">
                  <span className="raised-chip"><Rocket size={13} />{launch.raised}</span>
                  <span className="bond-chip">{launch.progress}% bonded</span>
                </div>
                <div className="token-foot">
                  <span>{launch.creator.slice(0, 6)}...{launch.creator.slice(-4)}</span>
                  <span>{launch.age}</span>
                </div>
              </div>
              <div className="progress"><span style={{ width: `${launch.progress}%` }} /></div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function formatUsdFromEthText(value: string, ethUsd: number | null) {
  const ethValue = parseDisplayAmount(value);
  if (!ethUsd || !Number.isFinite(ethValue) || ethValue <= 0) return "$-";
  return compactUsd(ethValue * ethUsd);
}

function FilterButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button className={active ? "feed-tab active" : "feed-tab"} onClick={onClick} role="tab" type="button" aria-selected={active}>
      {children}
    </button>
  );
}
