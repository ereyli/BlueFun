"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Clock, Grid2X2, Rocket, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Trophy } from "lucide-react";
import { isFeaturedLaunch, isTrustedLaunch } from "@/lib/featured-launches";
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
    }, 30_000);
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
      const featuredDelta = Number(isFeaturedLaunch(b)) - Number(isFeaturedLaunch(a));
      if (featuredDelta !== 0) return featuredDelta;
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

  const stats = useMemo(() => {
    const totalVolumeEth = launches.reduce((sum, launch) => sum + parseDisplayAmount(launch.volume), 0);
    const highestMarketCapEth = launches.reduce((max, launch) => Math.max(max, parseDisplayAmount(launch.marketCap)), 0);
    const creatorCount = new Set(launches.map((launch) => launch.creator.toLowerCase())).size;
    return {
      tokens: launches.length.toLocaleString("en-US"),
      volume: formatUsdFromEthNumber(totalVolumeEth, ethUsd),
      highestMarketCap: formatUsdFromEthNumber(highestMarketCapEth, ethUsd),
      creators: creatorCount.toLocaleString("en-US")
    };
  }, [ethUsd, launches]);

  const trendingLaunches = useMemo(() => {
    return [...launches]
      .sort((a, b) => {
        const featuredDelta = Number(isFeaturedLaunch(b)) - Number(isFeaturedLaunch(a));
        if (featuredDelta !== 0) return featuredDelta;
        return b.progress - a.progress || parseDisplayAmount(b.marketCap) - parseDisplayAmount(a.marketCap);
      })
      .slice(0, 8);
  }, [launches]);

  return (
    <section className="explorer-shell">
      <div className="explorer-stats-grid" aria-label="Launchpad metrics">
        <MetricCard label="Tokens" value={stats.tokens} detail="Total launched" />
        <MetricCard label="Volume" value={stats.volume} detail="Indexed curve volume" />
        <MetricCard label="Highest MC" value={stats.highestMarketCap} detail="Top live valuation" />
        <MetricCard label="Creators" value={stats.creators} detail="Unique launchers" />
      </div>

      <div className="trending-section">
        <div className="section-row">
          <div className="section-title"><Activity size={18} />Trending</div>
          <Link className="button primary compact" href="/launch"><Rocket size={15} />Launch</Link>
        </div>
        {trendingLaunches.length === 0 ? (
          <div className="empty compact-empty">No launches indexed yet.</div>
        ) : (
          <div className="trending-rail">
            {trendingLaunches.map((launch) => {
              const featured = isFeaturedLaunch(launch);
              const trusted = isTrustedLaunch(launch);
              return (
              <Link className={featured ? "trending-card featured" : "trending-card"} href={`/launch/${launch.id}`} key={`trend-${launch.id}-${launch.token}`}>
                <TokenAvatar launch={launch} />
                <div className="trending-copy">
                  <strong>{launch.symbol}{trusted ? <span>Trusted</span> : featured ? <span>Featured</span> : null}</strong>
                  <span>MC {formatUsdFromEthText(launch.marketCap, ethUsd)}</span>
                </div>
                <div className="trending-progress">
                  <div><span>Progress</span><b>{launch.progress}%</b></div>
                  <div className="progress"><span style={{ width: `${launch.progress}%` }} /></div>
                </div>
              </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="explore-toolbar">
        <div className="searchbar">
          <Search size={18} color="var(--blue)" />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search coins, tickers, creators or addresses..."
            value={query}
          />
        </div>
        <div className={isPending ? "live-sync syncing" : "live-sync"}>
          <span className="dot green" />
          {isPending ? "Syncing" : "Live"}
        </div>
      </div>

      <div className="explore-controls">
        <div className="feed-tabs" role="tablist" aria-label="Launch filters">
          <FilterButton active={filter === "Live"} onClick={() => setFilter("Live")}><Sparkles size={14} />Live</FilterButton>
          <FilterButton active={filter === "New"} onClick={() => setFilter("New")}><Clock size={14} />Newest</FilterButton>
          <FilterButton active={filter === "Ready"} onClick={() => setFilter("Ready")}>Ready</FilterButton>
          <FilterButton active={filter === "Graduated"} onClick={() => setFilter("Graduated")}><Rocket size={14} />Graduated</FilterButton>
          <FilterButton active={filter === "Safe"} onClick={() => setFilter("Safe")}><ShieldCheck size={14} />Safe</FilterButton>
          <FilterButton active={filter === "Progress"} onClick={() => setFilter("Progress")}><Trophy size={14} />Progress</FilterButton>
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
          {filteredLaunches.map((launch, index) => {
            const featured = isFeaturedLaunch(launch);
            const trusted = isTrustedLaunch(launch);
            return (
            <Link className={featured ? "token-card featured" : "token-card"} href={`/launch/${launch.id}`} key={`${launch.id}-${launch.token}`}>
              <div className="token-card-main">
                <TokenAvatar launch={launch} hot={index === 0} />
                <div className="token-card-copy">
                  <div className="token-card-head">
                    <div>
                      <div className="token-title">{launch.name}{trusted ? <span>Trusted</span> : featured ? <span>Featured</span> : null}</div>
                      <div className="token-symbol">${launch.symbol}</div>
                    </div>
                    <span className={launch.status === "Live" ? "token-status live" : "token-status"}>{launch.status}</span>
                  </div>
                  <p className="token-description">
                    {launch.description || (launch.status === "Graduated" ? "DEX ready market" : "B20 curve launch")}
                  </p>
                </div>
              </div>
              <div className="token-progress-row">
                <span>Graduation Progress</span>
                <b>{launch.progress}%</b>
              </div>
              <div className="progress"><span style={{ width: `${launch.progress}%` }} /></div>
              <div className="token-stat-row">
                <div><span>Market Cap</span><strong>{formatUsdFromEthText(launch.marketCap, ethUsd)}</strong></div>
                <div><span>Raised</span><strong>{launch.raised}</strong></div>
                <div><span>Age</span><strong>{launch.age}</strong></div>
              </div>
              <div className="token-foot">
                <span>By {launch.creator.slice(0, 6)}...{launch.creator.slice(-4)}</span>
                <span>{launch.status === "Graduated" ? "DEX" : "Curve"}</span>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatUsdFromEthText(value: string, ethUsd: number | null) {
  const ethValue = parseDisplayAmount(value);
  return formatUsdFromEthNumber(ethValue, ethUsd);
}

function formatUsdFromEthNumber(ethValue: number, ethUsd: number | null) {
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

function MetricCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="explorer-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TokenAvatar({ hot, launch }: { hot?: boolean; launch: DeployedLaunch }) {
  return (
    <div className={hot ? "token-art hot" : "token-art"}>
      {launch.imageURI ? (
        <img className="token-image" src={ipfsToGatewayUrl(launch.imageURI)} alt={launch.name} />
      ) : (
        <>
          <div className="token-symbol-art">{launch.symbol.slice(0, 4)}</div>
          <div className="spark" />
        </>
      )}
    </div>
  );
}
