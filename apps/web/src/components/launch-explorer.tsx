"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Activity, BarChart3, Clock3, Coins, Radio, Rocket, Search, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { isFeaturedLaunch, isOfficialBlue, isTrustedLaunch } from "@/lib/featured-launches";
import { compactUsd, parseDisplayAmount } from "@/lib/market-math";
import type { DbLaunchMetrics, LaunchBuyActivity } from "@/lib/db-launches";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";
import { NetworkIcon, networkMeta } from "@/components/network-icon";
import { chainSlug } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";

type Filter = "Activity" | "Newest" | "Live" | "Graduated" | "Progress";
type NetworkMetrics = Partial<Record<8453 | 4663, DbLaunchMetrics>>;

export function LaunchExplorer({ launches: initialLaunches, totalLaunches, metrics, networkMetrics, chainId = 8453 }: { launches: DeployedLaunch[]; totalLaunches: number; metrics?: DbLaunchMetrics; networkMetrics?: NetworkMetrics; chainId?: number }) {
  const [launches, setLaunches] = useState(initialLaunches);
  const [total, setTotal] = useState(totalLaunches);
  const [page, setPage] = useState(1);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("Activity");
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [activityByLaunch, setActivityByLaunch] = useState<Map<string, LaunchBuyActivity>>(new Map());
  const [hotLaunchId, setHotLaunchId] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const tokensRef = useRef<HTMLDivElement>(null);
  const activityBlocksRef = useRef<Map<string, bigint>>(new Map());
  const activityReadyRef = useRef(false);
  const activeNetwork = networkMeta(chainId);

  useEffect(() => {
    setLaunches(initialLaunches);
    setTotal(totalLaunches);
    setPage(1);
    setQuery("");
    setFilter("Activity");
    setActivityByLaunch(new Map());
    setHotLaunchId(undefined);
    activityBlocksRef.current = new Map();
    activityReadyRef.current = false;
  }, [chainId, initialLaunches, totalLaunches]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsPageLoading(true);
      setLoadError(false);
      try {
        const serverFilter = filter === "Activity" || filter === "Newest" ? "All" : filter;
        const params = new URLSearchParams({ chain: chainSlug(chainId), page: String(page), filter: serverFilter });
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
    let active = true;
    let activityLoading = false;
    let highlightTimer: number | undefined;
    const controller = new AbortController();

    async function loadActivity() {
      if (activityLoading) return;
      activityLoading = true;
      try {
        const response = await fetch(`/api/launch-activity?chain=${chainSlug(chainId)}`, { signal: controller.signal });
        const payload = await response.json() as { activity?: LaunchBuyActivity[] };
        if (!response.ok || !active) return;
        const items = payload.activity ?? [];
        const nextBlocks = new Map(items.map((item) => [item.launchId, safeBlockNumber(item.blockNumber)]));

        if (activityReadyRef.current) {
          const fresh = items
            .filter((item) => safeBlockNumber(item.blockNumber) > (activityBlocksRef.current.get(item.launchId) ?? 0n))
            .sort((a, b) => compareBlocks(b.blockNumber, a.blockNumber))[0];
          if (fresh) {
            setHotLaunchId(fresh.launchId);
            window.clearTimeout(highlightTimer);
            highlightTimer = window.setTimeout(() => setHotLaunchId(undefined), 4_000);
          }
        }

        activityBlocksRef.current = nextBlocks;
        activityReadyRef.current = true;
        setActivityByLaunch(new Map(items.map((item) => [item.launchId, item])));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // The launch feed remains usable if the lightweight activity pulse is unavailable.
        }
      } finally {
        activityLoading = false;
      }
    }

    loadActivity();
    const interval = window.setInterval(loadActivity, 4_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(highlightTimer);
    };
  }, [chainId]);

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

  const networkStats = useMemo(() => ([8453, 4663] as const).map((networkChainId) => {
    const values = networkMetrics?.[networkChainId] ?? (networkChainId === chainId ? metrics : undefined);
    const activeFallback = networkChainId === chainId;
    return {
      chainId: networkChainId,
      name: networkMeta(networkChainId).name,
      tokens: values?.totalTokens ?? (activeFallback ? totalLaunches : 0),
      graduated: values?.totalGraduated ?? (activeFallback ? initialLaunches.filter((launch) => launch.status === "Graduated").length : 0),
      volume: formatUsdFromEthNumber(values?.totalVolumeEth ?? (activeFallback ? launches.reduce((sum, launch) => sum + parseDisplayAmount(launch.volume), 0) : 0), ethUsd)
    };
  }), [chainId, ethUsd, initialLaunches, launches, metrics, networkMetrics, totalLaunches]);

  const trendingLaunches = useMemo(() => {
    return [...initialLaunches]
      .sort((a, b) => {
        const featuredDelta = Number(isFeaturedLaunch(b)) - Number(isFeaturedLaunch(a));
        if (featuredDelta !== 0) return featuredDelta;
        return b.progress - a.progress || parseDisplayAmount(b.marketCap) - parseDisplayAmount(a.marketCap);
      })
      .slice(0, 4);
  }, [initialLaunches]);
  const totalPages = Math.ceil(total / 21);
  const pagination = paginationItems(page, totalPages);
  const displayedLaunches = useMemo(() => {
    const sorted = [...launches];
    if (filter === "Newest") return sorted.sort((a, b) => compareLaunchIds(b.id, a.id));
    if (filter === "Progress") return sorted;
    return sorted.sort((a, b) => {
      const activityDelta = compareBlocks(activityByLaunch.get(b.id)?.blockNumber, activityByLaunch.get(a.id)?.blockNumber);
      return activityDelta || compareLaunchIds(b.id, a.id);
    });
  }, [activityByLaunch, filter, launches]);

  return (
    <section className="explorer-shell">
      <section className="launchpad-intro launchpad-overview premium-hero">
        <div className="launchpad-intro-copy">
          <div className="launchpad-eyebrow"><NetworkIcon chainId={chainId} size={20} /><span>{activeNetwork.name}</span><i>Markets live</i></div>
          <h1>Discover fair launches.<span>Trade with clarity.</span></h1>
          <p>Transparent bonding curves, fixed rules and permanently locked liquidity in one focused market.</p>
          <div className="launchpad-intro-actions">
            <Link className="button primary hero-action" href={`/launch?chain=${chainSlug(chainId)}`}><Rocket size={17} />Create a token</Link>
            <button
              className="button hero-secondary"
              onClick={() => {
                setFilter("Live");
                setPage(1);
                window.requestAnimationFrame(() => tokensRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
              type="button"
            >
              <ShieldCheck size={16} />Explore bonding markets
            </button>
          </div>
        </div>
        <div className="overview-metrics network-overview" aria-label="Network launch metrics">
          <div className="network-overview-head"><span>Network overview</span><small>Live indexed data</small></div>
          {networkStats.map((network) => (
            <Link className={network.chainId === chainId ? "network-metric-row active" : "network-metric-row"} href={`/?chain=${chainSlug(network.chainId)}`} key={network.chainId}>
              <div className="network-metric-name"><NetworkIcon chainId={network.chainId} size={22} /><strong>{network.name}</strong>{network.chainId === chainId ? <i>Viewing</i> : null}</div>
              <MetricCompact icon={<Coins size={14} />} label="Tokens" value={network.tokens.toLocaleString("en-US")} />
              <MetricCompact icon={<Trophy size={14} />} label="LP locked" value={network.graduated.toLocaleString("en-US")} />
              <MetricCompact icon={<BarChart3 size={14} />} label="Volume" value={network.volume} />
            </Link>
          ))}
        </div>
      </section>

      <div className="trending-section">
        <div className="section-row">
          <div>
            <div className="section-title"><Activity size={17} />Market spotlight</div>
            <p className="section-subtitle">Notable launches across {activeNetwork.name}</p>
          </div>
        </div>
        {trendingLaunches.length === 0 ? (
          <div className="empty compact-empty"><Sparkles size={18} /><span>Fresh launches will shine here.</span></div>
        ) : (
          <div className="trending-rail">
            {trendingLaunches.map((launch) => {
              const featured = isFeaturedLaunch(launch);
              const trusted = isTrustedLaunch(launch);
              const officialBlue = isOfficialBlue(launch);
              return (
              <Link className={featured ? "trending-card featured" : "trending-card"} href={tokenPath(launch)} key={`trend-${launch.id}-${launch.token}`}>
                <TokenAvatar launch={launch} />
                <div className="trending-copy">
                  <strong>{launch.symbol}{officialBlue ? <span>Official</span> : trusted ? <span>Trusted</span> : null}</strong>
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

      <section className="discovery-panel" ref={tokensRef}>
        <div className="discovery-heading">
          <div>
            <span>Launches</span>
            <h2>Explore markets</h2>
          </div>
          <div className={isPending || isPageLoading ? "live-sync syncing" : "live-sync"}>
            <span className="dot green" />
            {isPending || isPageLoading ? "Updating" : "Live data"}
          </div>
        </div>
        <div className="explore-toolbar">
          <div className="searchbar">
            <Search size={18} />
            <input
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Search token, ticker or address"
              value={query}
            />
          </div>
          <span className="explore-result-count">{total} {total === 1 ? "launch" : "launches"}</span>
        </div>

        <div className="explore-controls">
          <div className="feed-tabs" role="tablist" aria-label="Launch filters">
            <FilterButton active={filter === "Activity"} onClick={() => { setFilter("Activity"); setPage(1); }}><Radio size={14} />Active</FilterButton>
            <FilterButton active={filter === "Newest"} onClick={() => { setFilter("Newest"); setPage(1); }}><Clock3 size={14} />Newest</FilterButton>
            <FilterButton active={filter === "Live"} onClick={() => { setFilter("Live"); setPage(1); }}><Sparkles size={14} />Bonding</FilterButton>
            <FilterButton active={filter === "Progress"} onClick={() => { setFilter("Progress"); setPage(1); }}><Trophy size={14} />Progress</FilterButton>
            <FilterButton active={filter === "Graduated"} onClick={() => { setFilter("Graduated"); setPage(1); }}><Rocket size={14} />Graduated</FilterButton>
          </div>
        </div>
      </section>

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
          {totalLaunches === 0 ? <Link className="button primary compact" href={`/launch?chain=${chainSlug(chainId)}`}>Launch a token</Link> : null}
        </div>
      ) : (
        <div className={isPageLoading ? "token-grid page-loading" : "token-grid"} aria-busy={isPageLoading}>
          {displayedLaunches.map((launch, index) => {
            const featured = isFeaturedLaunch(launch);
            const trusted = isTrustedLaunch(launch);
            const officialBlue = isOfficialBlue(launch);
            const isHot = hotLaunchId === launch.id;
            return (
            <Link className={`${featured ? "token-card featured" : "token-card"}${isHot ? " activity-hot" : ""}`} href={tokenPath(launch)} key={`${launch.chainId}-${launch.id}-${launch.token}`}>
              <div className="token-card-main">
                <TokenAvatar launch={launch} hot={isHot || index === 0} />
                <div className="token-card-copy">
                  <div className="token-card-head">
                    <div>
                      <div className="token-title">{launch.name}{officialBlue ? <span>Official BLUE</span> : trusted ? <span>Trusted</span> : null}</div>
                      <div className="token-symbol">${launch.symbol}</div>
                    </div>
                    <span className={launch.status === "Live" ? "token-status live" : "token-status"}>{isHot ? "Buy now" : launch.status === "Live" ? "Bonding" : launch.status}</span>
                  </div>
                  <p className="token-description">
                    {launch.description || (launch.status === "Graduated" ? "DEX ready market" : launch.chainId === 4663 ? "ERC-20 curve launch" : "B20 curve launch")}
                  </p>
                </div>
              </div>
              <div className="token-stat-row">
                <div><span>Raised</span><strong>{launch.raised}</strong></div>
                <div><span>Progress</span><strong>{launch.progress}%</strong></div>
                <div><span>Age</span><strong>{launch.age}</strong></div>
              </div>
              <div className="progress token-card-progress" aria-label={`Graduation progress ${launch.progress}%`}><span style={{ width: `${launch.progress}%` }} /></div>
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

function MetricCompact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="network-metric-value">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function safeBlockNumber(value?: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function compareBlocks(left?: string, right?: string) {
  const a = safeBlockNumber(left);
  const b = safeBlockNumber(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

function compareLaunchIds(left: string, right: string) {
  return compareBlocks(left, right);
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
