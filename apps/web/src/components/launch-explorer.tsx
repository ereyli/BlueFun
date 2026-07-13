"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Activity, BarChart3, Clock, Coins, Rocket, Search, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import { isFeaturedLaunch, isTrustedLaunch } from "@/lib/featured-launches";
import { compactUsd, parseDisplayAmount } from "@/lib/market-math";
import type { DbLaunchMetrics } from "@/lib/db-launches";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";
import { NetworkIcon, networkMeta } from "@/components/network-icon";

type Filter = "Live" | "New" | "Ready" | "Graduated" | "Safe" | "Progress";

export function LaunchExplorer({ launches: initialLaunches, totalLaunches, metrics, chainId = 8453 }: { launches: DeployedLaunch[]; totalLaunches: number; metrics?: DbLaunchMetrics; chainId?: number }) {
  const [launches, setLaunches] = useState(initialLaunches);
  const [total, setTotal] = useState(totalLaunches);
  const [page, setPage] = useState(1);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("New");
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const tokensRef = useRef<HTMLDivElement>(null);
  const activeNetwork = networkMeta(chainId);

  useEffect(() => {
    setLaunches(initialLaunches);
    setTotal(totalLaunches);
    setPage(1);
    setQuery("");
    setFilter("New");
  }, [chainId, initialLaunches, totalLaunches]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsPageLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams({ chain: String(chainId), page: String(page), filter });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/launches?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json() as { launches?: DeployedLaunch[]; total?: number; totalPages?: number };
        if (!response.ok) throw new Error("Launch page unavailable");
        setLaunches(payload.launches ?? []);
        setTotal(Number(payload.total || 0));
        if (payload.totalPages && page > payload.totalPages) setPage(payload.totalPages);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setIsPageLoading(false);
      }
    }, query ? 260 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [chainId, filter, page, query, refreshNonce]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") startTransition(() => setRefreshNonce((value) => value + 1));
    };
    const interval = window.setInterval(() => {
      refreshWhenVisible();
    }, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

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

  const stats = useMemo(() => {
    const totalVolumeEth = metrics?.totalVolumeEth ?? launches.reduce((sum, launch) => sum + parseDisplayAmount(launch.volume), 0);
    const creatorCount = new Set(launches.map((launch) => launch.creator.toLowerCase())).size;
    return {
      tokens: (metrics?.totalTokens ?? totalLaunches).toLocaleString("en-US"),
      volume: formatUsdFromEthNumber(totalVolumeEth, ethUsd),
      creators: (metrics?.totalCreators ?? creatorCount).toLocaleString("en-US"),
      graduated: (metrics?.totalGraduated ?? initialLaunches.filter((launch) => launch.status === "Graduated").length).toLocaleString("en-US")
    };
  }, [ethUsd, initialLaunches, launches, metrics, totalLaunches]);

  const trendingLaunches = useMemo(() => {
    return [...initialLaunches]
      .sort((a, b) => {
        const featuredDelta = Number(isFeaturedLaunch(b)) - Number(isFeaturedLaunch(a));
        if (featuredDelta !== 0) return featuredDelta;
        return b.progress - a.progress || parseDisplayAmount(b.marketCap) - parseDisplayAmount(a.marketCap);
      })
      .slice(0, 8);
  }, [initialLaunches]);
  const totalPages = Math.ceil(total / 21);
  const pagination = paginationItems(page, totalPages);

  return (
    <section className="explorer-shell">
      <section className="launchpad-intro launchpad-overview">
        <div className="launchpad-intro-copy">
          <div className="launchpad-eyebrow"><NetworkIcon chainId={chainId} size={22} /><span>{activeNetwork.name} launchpad</span><i>Live</i></div>
          <h1>Launch bold ideas. <span>Trade them early.</span></h1>
          <p>Fair curves, transparent rules and permanently locked liquidity—built for communities, not insiders.</p>
          <div className="launchpad-intro-actions">
            <Link className="button primary hero-action" href={`/launch?chain=${chainId}`}><Rocket size={17} />Create a token</Link>
            <span className="intro-trust"><ShieldCheck size={16} />Auditable onchain</span>
          </div>
        </div>
        <div className="overview-metrics" aria-label="Launchpad metrics">
          <MetricCard icon={<Coins size={17} />} label="Tokens" value={stats.tokens} detail="Launched" />
          <MetricCard icon={<BarChart3 size={17} />} label="Volume" value={stats.volume} detail="Buy + sell" />
          <MetricCard icon={<Users size={17} />} label="Creators" value={stats.creators} detail="Unique" />
          <MetricCard icon={<Trophy size={17} />} label="Graduated" value={stats.graduated} detail="LP locked" />
        </div>
      </section>

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

      <div className="explore-toolbar" ref={tokensRef}>
        <div className="searchbar">
          <Search size={18} color="var(--blue)" />
          <input
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Search coins, tickers, creators or addresses..."
            value={query}
          />
        </div>
        <div className={isPending || isPageLoading ? "live-sync syncing" : "live-sync"}>
          <span className="dot green" />
          {isPending || isPageLoading ? "Syncing" : "Live"}
        </div>
      </div>

      <div className="explore-controls">
        <div className="feed-tabs" role="tablist" aria-label="Launch filters">
          <FilterButton active={filter === "Live"} onClick={() => { setFilter("Live"); setPage(1); }}><Sparkles size={14} />Live</FilterButton>
          <FilterButton active={filter === "New"} onClick={() => { setFilter("New"); setPage(1); }}><Clock size={14} />Newest</FilterButton>
          <FilterButton active={filter === "Ready"} onClick={() => { setFilter("Ready"); setPage(1); }}>Ready</FilterButton>
          <FilterButton active={filter === "Graduated"} onClick={() => { setFilter("Graduated"); setPage(1); }}><Rocket size={14} />Graduated</FilterButton>
          <FilterButton active={filter === "Safe"} onClick={() => { setFilter("Safe"); setPage(1); }}><ShieldCheck size={14} />Safe</FilterButton>
          <FilterButton active={filter === "Progress"} onClick={() => { setFilter("Progress"); setPage(1); }}><Trophy size={14} />Progress</FilterButton>
        </div>
        <span className="explore-result-count">{total} {total === 1 ? "launch" : "launches"}</span>
      </div>

      {loadError ? (
        <div className="explore-data-warning" role="status">
          Live data could not be refreshed. Showing the last successful results.
          <button type="button" onClick={() => setRefreshNonce((value) => value + 1)}>Try again</button>
        </div>
      ) : null}

      {launches.length === 0 && !isPageLoading ? (
        <div className="empty premium-empty">
          <div className="empty-orb"><Rocket size={27} /></div>
          <strong>{totalLaunches === 0 ? `Be first on ${activeNetwork.name}` : "No matching launches"}</strong>
          <span>{totalLaunches === 0 ? "Create the first fair token and start the market." : "Try another search or filter."}</span>
          {totalLaunches === 0 ? <Link className="button primary compact" href={`/launch?chain=${chainId}`}>Launch a token</Link> : null}
        </div>
      ) : (
        <div className={isPageLoading ? "token-grid page-loading" : "token-grid"} aria-busy={isPageLoading}>
          {launches.map((launch, index) => {
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
      {totalPages > 1 ? (
        <nav className="launch-pagination" aria-label="Launch pages">
          <button disabled={page === 1 || isPageLoading} onClick={() => changePage(page - 1)} type="button" aria-label="Previous page">‹</button>
          {pagination.map((item, index) => item === "…"
            ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span>
            : <button className={item === page ? "active" : ""} disabled={isPageLoading} onClick={() => changePage(item)} type="button" aria-current={item === page ? "page" : undefined} key={item}>{item}</button>
          )}
          <button disabled={page === totalPages || isPageLoading} onClick={() => changePage(page + 1)} type="button" aria-label="Next page">›</button>
        </nav>
      ) : null}
    </section>
  );

  function changePage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    if (safePage === page) return;
    setPage(safePage);
    window.requestAnimationFrame(() => tokensRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
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

function paginationItems(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1].filter((value) => value >= 1 && value <= total));
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: Array<number | "…"> = [];
  for (const value of sorted) {
    const previous = result.at(-1);
    if (typeof previous === "number" && value - previous > 1) result.push("…");
    result.push(value);
  }
  return result;
}

function TokenAvatar({ hot, launch }: { hot?: boolean; launch: DeployedLaunch }) {
  const [failedImage, setFailedImage] = useState("");
  const showImage = Boolean(launch.imageURI) && failedImage !== launch.imageURI;
  return (
    <div className={hot ? "token-art hot" : "token-art"}>
      {showImage ? (
        <img
          className="token-image"
          src={optimizedTokenImageUrl(launch.imageURI)}
          alt={launch.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailedImage(launch.imageURI || "")}
        />
      ) : (
        <>
          <div className="token-symbol-art">{launch.symbol.slice(0, 4)}</div>
          <div className="spark" />
        </>
      )}
    </div>
  );
}
