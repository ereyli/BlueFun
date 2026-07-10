"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, BarChart3, Clock, Coins, Crown, Rocket, Search, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import { isFeaturedLaunch, isTrustedLaunch } from "@/lib/featured-launches";
import { compactUsd, parseDisplayAmount } from "@/lib/market-math";
import type { DbLaunchMetrics } from "@/lib/db-launches";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { ipfsToGatewayUrl } from "@/lib/token-metadata";
import { NetworkIcon, networkMeta } from "@/components/network-icon";

type Filter = "Live" | "New" | "Ready" | "Graduated" | "Safe" | "Progress";

export function LaunchExplorer({ launches, metrics, chainId = 8453 }: { launches: DeployedLaunch[]; metrics?: DbLaunchMetrics; chainId?: number }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("New");
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeNetwork = networkMeta(chainId);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const interval = window.setInterval(() => {
      refreshWhenVisible();
    }, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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
    const interval = window.setInterval(loadEthPrice, 300_000);
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
      if (filter === "Safe") return launch.risk === "Adminless" || launch.risk === "B20 gated" || launch.risk === "Fixed-supply ERC-20";
      if (filter === "Progress") return true;
      return launch.status === filter;
    });
  }, [filter, launches, query]);

  const stats = useMemo(() => {
    const totalVolumeEth = metrics?.totalVolumeEth ?? launches.reduce((sum, launch) => sum + parseDisplayAmount(launch.volume), 0);
    const highestMarketCapEth = launches.reduce((max, launch) => Math.max(max, parseDisplayAmount(launch.marketCap)), 0);
    const creatorCount = new Set(launches.map((launch) => launch.creator.toLowerCase())).size;
    return {
      tokens: launches.length.toLocaleString("en-US"),
      volume: formatUsdFromEthNumber(totalVolumeEth, ethUsd),
      highestMarketCap: formatUsdFromEthNumber(highestMarketCapEth, ethUsd),
      creators: creatorCount.toLocaleString("en-US")
    };
  }, [ethUsd, launches, metrics?.totalVolumeEth]);

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
      <section className="launchpad-intro">
        <div className="launchpad-intro-copy">
          <div className="launchpad-eyebrow"><NetworkIcon chainId={chainId} size={22} /><span>{activeNetwork.name} launchpad</span><i>Live</i></div>
          <h1>Launch bold ideas.<br /><span>Trade them early.</span></h1>
          <p>Fair curves, transparent rules and permanently locked liquidity—built for communities, not insiders.</p>
          <div className="launchpad-intro-actions">
            <Link className="button primary hero-action" href={`/launch?chain=${chainId}`}><Rocket size={17} />Create a token</Link>
            <span className="intro-trust"><ShieldCheck size={16} />Auditable onchain</span>
          </div>
        </div>
        <div className="launchpad-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-core"><NetworkIcon chainId={chainId} size={54} /></div>
          <span className="orbit-chip chip-one">Fair launch</span>
          <span className="orbit-chip chip-two">LP locked</span>
          <span className="orbit-chip chip-three">Live markets</span>
        </div>
      </section>
      <div className="explorer-stats-grid" aria-label="Launchpad metrics">
        <MetricCard icon={<Coins size={18} />} label="Tokens" value={stats.tokens} detail="Total launched" />
        <MetricCard icon={<BarChart3 size={18} />} label="Volume" value={stats.volume} detail="Total buy/sell volume" />
        <MetricCard icon={<Crown size={18} />} label="Highest MC" value={stats.highestMarketCap} detail="Top live valuation" />
        <MetricCard icon={<Users size={18} />} label="Creators" value={stats.creators} detail="Unique launchers" />
      </div>

      <div className="trending-section">
        <div className="section-row">
          <div className="section-title"><Activity size={18} />Trending</div>
          <Link className="button primary compact" href={`/launch?chain=${chainId}`}><Rocket size={15} />Launch</Link>
        </div>
        {trendingLaunches.length === 0 ? (
          <div className="empty compact-empty"><Sparkles size={18} /><span>Fresh launches will shine here.</span></div>
        ) : (
          <div className="trending-rail">
            {trendingLaunches.map((launch) => {
              const featured = isFeaturedLaunch(launch);
              const trusted = isTrustedLaunch(launch);
              return (
              <Link className={featured ? "trending-card featured" : "trending-card"} href={`/launch/${launch.id}?chain=${launch.chainId}`} key={`trend-${launch.id}-${launch.token}`}>
                <TokenAvatar launch={launch} />
                <div className="trending-copy">
                  <strong>{launch.symbol}{trusted ? <span>Trusted</span> : null}</strong>
                  <span>Raised {launch.raised}</span>
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
        <span className="explore-result-count">{filteredLaunches.length} {filteredLaunches.length === 1 ? "launch" : "launches"}</span>
      </div>

      {filteredLaunches.length === 0 ? (
        <div className="empty premium-empty">
          <div className="empty-orb"><Rocket size={27} /></div>
          <strong>{launches.length === 0 ? `Be first on ${activeNetwork.name}` : "No matching launches"}</strong>
          <span>{launches.length === 0 ? "Create the first fair token and start the market." : "Try another search or filter."}</span>
          {launches.length === 0 ? <Link className="button primary compact" href={`/launch?chain=${chainId}`}>Launch a token</Link> : null}
        </div>
      ) : (
        <div className="token-grid">
          {filteredLaunches.map((launch, index) => {
            const featured = isFeaturedLaunch(launch);
            const trusted = isTrustedLaunch(launch);
            return (
            <Link className={featured ? "token-card featured" : "token-card"} href={`/launch/${launch.id}?chain=${launch.chainId}`} key={`${launch.chainId}-${launch.id}-${launch.token}`}>
              <div className="token-card-main">
                <TokenAvatar launch={launch} hot={index === 0} />
                <div className="token-card-copy">
                  <div className="token-card-head">
                    <div>
                      <div className="token-title">{launch.name}{trusted ? <span>Trusted</span> : null}</div>
                      <div className="token-symbol">${launch.symbol}</div>
                    </div>
                    <span className={launch.status === "Live" ? "token-status live" : "token-status"}>{launch.status}</span>
                  </div>
                  <p className="token-description">
                    {launch.description || (launch.status === "Graduated" ? "DEX ready market" : launch.chainId === 4663 ? "ERC-20 curve launch" : "B20 curve launch")}
                  </p>
                </div>
              </div>
              <div className="token-progress-row">
                <span>Graduation Progress</span>
                <b>{launch.progress}%</b>
              </div>
              <div className="progress"><span style={{ width: `${launch.progress}%` }} /></div>
              <div className="token-stat-row">
                <div><span>Raised</span><strong>{launch.raised}</strong></div>
                <div><span>Market cap</span><strong>{formatUsdFromEthText(launch.marketCap, ethUsd)}</strong></div>
                <div><span>Age</span><strong>{launch.age}</strong></div>
              </div>
              <div className="token-foot">
                <span>By {launch.creator.slice(0, 6)}...{launch.creator.slice(-4)}</span>
                <span className="token-chain"><NetworkIcon chainId={launch.chainId} size={16} />{launch.status === "Graduated" ? "DEX" : networkMeta(launch.chainId).name}</span>
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

function MetricCard({ detail, icon, label, value }: { detail: string; icon: ReactNode; label: string; value: string }) {
  return (
    <div className="explorer-metric-card">
      <div className="metric-label"><i>{icon}</i><span>{label}</span></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TokenAvatar({ hot, launch }: { hot?: boolean; launch: DeployedLaunch }) {
  return (
    <div className={hot ? "token-art hot" : "token-art"}>
      {launch.imageURI ? (
        <img className="token-image" src={ipfsToGatewayUrl(launch.imageURI)} alt={launch.name} loading="lazy" decoding="async" />
      ) : (
        <>
          <div className="token-symbol-art">{launch.symbol.slice(0, 4)}</div>
          <div className="spark" />
        </>
      )}
    </div>
  );
}
