"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Activity, BarChart3, Clock3, Coins, LayoutGrid, Layers3, List, LockKeyhole, Rocket, Search, Sparkles, Trophy, TrendingUp, Zap } from "lucide-react";
import { isFeaturedLaunch, isOfficialBlue } from "@/lib/featured-launches";
import { compactUsd, parseDisplayAmount } from "@/lib/market-math";
import type { DbLaunchMetrics, LaunchBuyActivity } from "@/lib/db-launches";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";
import { NetworkIcon, networkMeta } from "@/components/network-icon";
import { chainSlug } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";
import { launchEconomics } from "@/lib/contracts";

type Filter = "All" | "Volume" | "MarketCap" | "New";
type ViewMode = "grid" | "list";
type NetworkMetrics = Partial<Record<8453 | 4663 | 143, DbLaunchMetrics>>;

export function LaunchExplorer({ launches: initialLaunches, totalLaunches, metrics, networkMetrics, chainId = 8453 }: { launches: DeployedLaunch[]; totalLaunches: number; metrics?: DbLaunchMetrics; networkMetrics?: NetworkMetrics; chainId?: number }) {
  const [launches, setLaunches] = useState(initialLaunches);
  const [total, setTotal] = useState(totalLaunches);
  const [page, setPage] = useState(1);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [nativeUsd, setNativeUsd] = useState<number | null>(null);
  const [dexMarketCaps, setDexMarketCaps] = useState<Map<string, number>>(new Map());
  const [activityByLaunch, setActivityByLaunch] = useState<Map<string, LaunchBuyActivity>>(new Map());
  const [hotLaunchKey, setHotLaunchKey] = useState<string>();
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
    setFilter("All");
    setActivityByLaunch(new Map());
    setHotLaunchKey(undefined);
    activityBlocksRef.current = new Map();
    activityReadyRef.current = false;
  }, [chainId, initialLaunches, totalLaunches]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsPageLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams({ chain: chainSlug(chainId), page: String(page), filter });
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
        const nextBlocks = new Map(items.map((item) => [activityKey(item), safeBlockNumber(item.blockNumber)]));

        if (activityReadyRef.current) {
          const fresh = items
            .filter((item) => safeBlockNumber(item.blockNumber) > (activityBlocksRef.current.get(activityKey(item)) ?? 0n))
            .sort((a, b) => compareBlocks(b.blockNumber, a.blockNumber))[0];
          if (fresh) {
            setHotLaunchKey(activityKey(fresh));
            window.clearTimeout(highlightTimer);
            highlightTimer = window.setTimeout(() => setHotLaunchKey(undefined), 4_000);
          }
        }

        activityBlocksRef.current = nextBlocks;
        activityReadyRef.current = true;
        setActivityByLaunch(new Map(items.map((item) => [activityKey(item), item])));
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
    const graduated = launches.filter((launch) => launch.chainId === 8453 && launch.status === "Graduated");
    if (graduated.length === 0) {
      setDexMarketCaps(new Map());
      return;
    }

    const controller = new AbortController();
    let active = true;
    Promise.all(graduated.map(async (launch) => {
      try {
        const response = await fetch(`/api/dexscreener/token/${launch.token}?chain=base`, { signal: controller.signal });
        const payload = await response.json() as { pair?: { marketCap?: number } | null };
        const marketCap = Number(payload.pair?.marketCap);
        return Number.isFinite(marketCap) && marketCap > 0 ? [launch.token.toLowerCase(), marketCap] as const : undefined;
      } catch {
        return undefined;
      }
    })).then((items) => {
      if (active) setDexMarketCaps(new Map(items.filter((item): item is readonly [string, number] => Boolean(item))));
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [launches]);

  useEffect(() => {
    let active = true;
    async function loadNativePrice() {
      try {
        const response = await fetch(`/api/native-price?chain=${chainSlug(chainId)}`, { cache: "no-store" });
        const payload = await response.json() as { nativeUsd?: number | null };
        if (active) setNativeUsd(payload.nativeUsd ?? null);
      } catch {
        if (active) setNativeUsd(null);
      }
    }
    loadNativePrice();
    const interval = window.setInterval(loadNativePrice, 300_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [chainId]);

  const networkStats = useMemo(() => ([8453, 4663, 143] as const).map((networkChainId) => {
    const values = networkMetrics?.[networkChainId] ?? (networkChainId === chainId ? metrics : undefined);
    const activeFallback = networkChainId === chainId;
    return {
      chainId: networkChainId,
      name: networkMeta(networkChainId).name,
      tokens: values?.totalTokens ?? (activeFallback ? totalLaunches : 0),
      graduated: values?.totalGraduated ?? (activeFallback ? initialLaunches.filter((launch) => launch.status === "Graduated").length : 0),
      volume: networkChainId === chainId
        ? formatUsdFromNativeNumber(values?.totalVolumeEth ?? (activeFallback ? launches.reduce((sum, launch) => sum + parseDisplayAmount(launch.volume), 0) : 0), nativeUsd)
        : formatNativeNumber(values?.totalVolumeEth ?? 0, networkMeta(networkChainId).symbol)
    };
  }), [chainId, initialLaunches, launches, metrics, nativeUsd, networkMetrics, totalLaunches]);

  const pulseLaunches = useMemo(() => {
    return [...initialLaunches]
      .sort((a, b) => {
        const activityDelta = compareBlocks(
          activityByLaunch.get(activityKey(b))?.blockNumber,
          activityByLaunch.get(activityKey(a))?.blockNumber
        );
        if (activityDelta !== 0) return activityDelta;
        const featuredDelta = Number(isFeaturedLaunch(b)) - Number(isFeaturedLaunch(a));
        if (featuredDelta !== 0) return featuredDelta;
        return compareLaunchIds(b.id, a.id);
      })
      .slice(0, 5);
  }, [activityByLaunch, initialLaunches]);
  const totalPages = Math.ceil(total / 21);
  const pagination = paginationItems(page, totalPages);
  const displayedLaunches = useMemo(() => {
    const sorted = [...launches];
    if (filter === "New") return sorted.sort((a, b) => compareLaunchCreated(b, a));
    if (filter === "Volume") return sorted.sort((a, b) => parseDisplayAmount(b.volume) - parseDisplayAmount(a.volume) || compareLaunchCreated(b, a));
    if (filter === "MarketCap") return sorted.sort((a, b) => marketCapSortValue(b, dexMarketCaps) - marketCapSortValue(a, dexMarketCaps) || compareLaunchCreated(b, a));
    return sorted.sort((a, b) => parseDisplayAmount(b.volume) - parseDisplayAmount(a.volume)
      || marketCapSortValue(b, dexMarketCaps) - marketCapSortValue(a, dexMarketCaps)
      || compareLaunchCreated(b, a));
  }, [dexMarketCaps, filter, launches]);

  return (
    <section className="explorer-shell">
      <section className="launchpad-intro launchpad-overview premium-hero">
        <div className="launchpad-intro-copy">
          <div className="launchpad-eyebrow"><NetworkIcon chainId={chainId} size={20} /><span>{activeNetwork.name}</span><i>Live tape</i></div>
          <h1>Launch it.<span>Lock it. Let it trade.</span></h1>
          <p>One billion tokens, visible rules and liquidity that stays put.</p>
          <div className="launchpad-intro-actions">
            <Link className="button primary hero-action" href={`/launch?chain=${chainSlug(chainId)}`}><Rocket size={17} />Open launch studio</Link>
            <button
              className="button hero-secondary"
              onClick={() => {
                setFilter("All");
                setPage(1);
                window.requestAnimationFrame(() => tokensRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
              type="button"
            >
              <Activity size={16} />Browse markets
            </button>
          </div>
        </div>
        <div className="overview-metrics network-overview" aria-label="Network launch metrics">
          <div className="network-overview-head"><span>Network tape</span><small>Indexed onchain</small></div>
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

      <div className="trending-section market-pulse-section">
        <div className="section-row">
          <div>
            <div className="section-title"><Zap size={17} />Onchain tape</div>
            <p className="section-subtitle">Latest confirmed buys · {activeNetwork.name}</p>
          </div>
          <span className="pulse-live-label"><i />Live</span>
        </div>
        {pulseLaunches.length === 0 ? (
          <div className="empty compact-empty"><Sparkles size={18} /><span>Fresh market activity will appear here.</span></div>
        ) : (
          <div className="market-pulse-rail">
            {pulseLaunches.map((launch) => {
              const officialBlue = isOfficialBlue(launch);
              const key = activityKey(launch);
              const activity = activityByLaunch.get(key);
              const isHot = hotLaunchKey === key;
              return (
              <Link className={isHot ? "market-pulse-item hot" : "market-pulse-item"} href={tokenPath(launch)} key={`pulse-${launch.id}-${launch.token}`}>
                <TokenAvatar launch={launch} hot={isHot} />
                <div className="market-pulse-copy">
                  <strong>${launch.symbol}{officialBlue ? <span>Official</span> : null}</strong>
                  <small>{activity ? `Buy ${formatActivityAge(activity.createdAt)}` : `Launched ${launch.age}`}</small>
                </div>
                <div className="market-pulse-value">
                  <span>{launch.launchMode === "direct" ? "Direct DEX" : launch.status === "Graduated" ? "DEX live" : `${launch.progress}% bond`}</span>
                  <strong>{launch.launchMode === "direct" ? "LP locked" : launch.raised}</strong>
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
            <h2>Market directory</h2>
          </div>
          <div className={isPending || isPageLoading ? "live-sync syncing" : "live-sync"}>
            <span className="dot green" />
            {isPending || isPageLoading ? "Updating" : "Live data"}
          </div>
        </div>
        <div className="explore-toolbar market-directory-toolbar">
          <div className="searchbar">
            <Search size={18} />
            <input
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Search token, ticker or address"
              value={query}
            />
          </div>
          <div className="market-directory-actions">
            <div className="feed-tabs market-sort-tabs" role="tablist" aria-label="Sort markets">
              <FilterButton active={filter === "All"} onClick={() => { setFilter("All"); setPage(1); }}><Layers3 size={14} />All</FilterButton>
              <FilterButton active={filter === "Volume"} onClick={() => { setFilter("Volume"); setPage(1); }}><BarChart3 size={14} />Top volume</FilterButton>
              <FilterButton active={filter === "MarketCap"} onClick={() => { setFilter("MarketCap"); setPage(1); }}><TrendingUp size={14} />Market cap</FilterButton>
              <FilterButton active={filter === "New"} onClick={() => { setFilter("New"); setPage(1); }}><Clock3 size={14} />New</FilterButton>
            </div>
            <div className="market-view-toggle" aria-label="Market view">
              <button aria-label="Card view" aria-pressed={viewMode === "grid"} className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} type="button"><LayoutGrid size={15} /></button>
              <button aria-label="List view" aria-pressed={viewMode === "list"} className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} type="button"><List size={16} /></button>
            </div>
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
        <div className={`token-grid ${viewMode === "list" ? "list-view" : "grid-view"}${isPageLoading ? " page-loading" : ""}`} aria-busy={isPageLoading}>
          {viewMode === "list" ? (
            <div className="market-list-head" aria-hidden="true">
              <span>Token</span><span>Market cap</span><span>Volume</span><span>Market</span><span>Creator</span>
            </div>
          ) : null}
          {displayedLaunches.map((launch, index) => {
            const direct = launch.launchMode === "direct";
            const featured = isFeaturedLaunch(launch);
            const officialBlue = isOfficialBlue(launch);
            const key = activityKey(launch);
            const isHot = hotLaunchKey === key;
            const activity = activityByLaunch.get(key);
            const hasMarketCap = launch.marketCap.trim().toLowerCase() !== "live" && parseDisplayAmount(launch.marketCap) > 0;
            const dexMarketCap = dexMarketCaps.get(launch.token.toLowerCase());
            const marketCapNative = hasMarketCap ? launch.marketCap : direct ? "Live" : estimateCurveMarketCap(launch.raised, launch.chainId);
            const marketCap = dexMarketCap ? compactUsd(dexMarketCap) : formatLaunchUsd(marketCapNative, nativeUsd);
            const marketCapLabel = dexMarketCap || hasMarketCap ? "Market cap" : direct ? "Market data" : "Estimated MC";
            const volume = formatLaunchUsd(launch.volume, nativeUsd);
            return (
            <Link className={`${featured ? "token-card featured" : "token-card"}${isHot ? " activity-hot" : ""}`} href={tokenPath(launch)} key={`${launch.chainId}-${launch.id}-${launch.token}`}>
              <div className="token-card-visual">
                <TokenAvatar launch={launch} hot={isHot || index === 0} />
                <div className="token-card-visual-badges">
                  <span className={direct ? "token-status direct" : launch.status === "Live" ? "token-status live" : "token-status"}>{direct ? "Direct DEX" : isHot ? "Active buy" : launch.status === "Live" ? "Bonding" : launch.status === "Graduated" ? "Graduated" : "Bonded"}</span>
                  <span className="token-chain-badge"><NetworkIcon chainId={launch.chainId} size={15} />{networkMeta(launch.chainId).name}</span>
                </div>
              </div>
              <div className="token-card-content">
                <div className="token-card-identity">
                  <div className="token-title">{launch.name}{officialBlue ? <span>Official BLUE</span> : null}</div>
                  <div className="token-symbol">${launch.symbol}<span className={activity ? "token-activity-signal active" : "token-activity-signal"}><i />{activity ? `Buy ${formatActivityAge(activity.createdAt)}` : launch.age}</span></div>
                </div>
                <div className="token-market-row">
                  <div className="token-market-cap"><span>{marketCapLabel}</span><strong>{marketCap}</strong></div>
                  <div className="token-volume"><span>Volume</span><strong>{volume}</strong></div>
                </div>
                <div className="token-state-cell">
                  {direct ? (
                    <div className="token-direct-state"><span><Zap size={12} />Direct DEX</span><strong><LockKeyhole size={12} />LP locked</strong></div>
                  ) : (
                    <>
                    <div className="token-progress-label">
                      <span>{launch.status === "Graduated" ? "Liquidity locked" : "Bonding progress"}</span>
                      <strong>{launch.status === "Graduated" ? "100%" : `${launch.progress}%`}</strong>
                    </div>
                    <div className={launch.status === "Graduated" ? "progress token-card-progress graduated" : "progress token-card-progress"} aria-label={`Graduation progress ${launch.progress}%`}><span style={{ width: `${launch.status === "Graduated" ? 100 : launch.progress}%` }} /></div>
                    </>
                  )}
                </div>
                <div className="token-foot">
                  <span>By {launch.creator.slice(0, 6)}...{launch.creator.slice(-4)} · {launch.age}</span>
                  <span>{direct || launch.status === "Graduated" ? "DEX live" : `Raised ${launch.raised}`}</span>
                </div>
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

function formatUsdFromNativeNumber(nativeValue: number, nativeUsd: number | null) {
  if (!nativeUsd || !Number.isFinite(nativeValue) || nativeValue <= 0) return "$-";
  return compactUsd(nativeValue * nativeUsd);
}

function formatNativeNumber(value: number, symbol: string) {
  return Number.isFinite(value) && value > 0 ? `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}` : `0 ${symbol}`;
}

function formatLaunchUsd(value: string, ethUsd: number | null) {
  if (value.trim().toLowerCase() === "live") return "Indexing";
  const ethValue = parseDisplayAmount(value);
  if (!Number.isFinite(ethValue) || ethValue <= 0) return "$0";
  if (!ethUsd) return value;
  const usdValue = ethValue * ethUsd;
  return usdValue < 1 ? "<$1" : compactUsd(usdValue);
}

function estimateCurveMarketCap(raisedValue: string, chainId: number) {
  const grossRaised = Math.max(0, parseDisplayAmount(raisedValue));
  const economics = launchEconomics(chainId);
  const initialVirtual = Number(economics.virtualNativeReserve);
  const virtualNative = initialVirtual + grossRaised * (1 - 0.01);
  const marketCapNative = (virtualNative * virtualNative) / initialVirtual;
  return `${marketCapNative.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${economics.nativeSymbol}`;
}

function marketCapSortValue(launch: DeployedLaunch, dexMarketCaps: Map<string, number>) {
  const dexValue = dexMarketCaps.get(launch.token.toLowerCase());
  if (dexValue) return dexValue;
  const explicitValue = parseDisplayAmount(launch.marketCap);
  if (explicitValue > 0) return explicitValue;
  return parseDisplayAmount(estimateCurveMarketCap(launch.raised, launch.chainId));
}

function formatActivityAge(createdAt: string) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
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

function compareLaunchCreated(left: DeployedLaunch, right: DeployedLaunch) {
  const blockDelta = compareBlocks(left.createdBlock, right.createdBlock);
  return blockDelta || compareLaunchIds(left.id, right.id);
}

function activityKey(item: Pick<LaunchBuyActivity, "scope" | "launchId"> | Pick<DeployedLaunch, "scope" | "id">) {
  const launchId = "launchId" in item ? item.launchId : item.id;
  return `${item.scope ?? ""}:${launchId}`;
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
