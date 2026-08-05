"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Check, ChevronDown, Rocket, Search, Zap } from "@/components/bluefun-icons";
import { isOfficialBlue } from "@/lib/featured-launches";
import { compactUsd, parseDisplayAmount } from "@/lib/market-math";
import type { LaunchBuyActivity, MarketSparkline } from "@/lib/db-launches";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";
import { NetworkIcon, networkMeta } from "@/components/network-icon";
import { chainSlug } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";
import { launchEconomics } from "@/lib/contracts";
import { indexerScopesForChain } from "@/lib/contracts";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { BlueFunState } from "@/components/bluefun-state";
import { isUiPreviewLaunch } from "@/lib/ui-preview-data";
import { MARKET_PAGE_SIZE } from "@/lib/market-pagination";
import { BrandLaunchpadMenu } from "@/components/brand-launchpad-menu";
import { DexProviderIcon, type DexProvider } from "@/components/dex-provider-icon";

type MarketCategory = "All" | "Progress" | "Direct";
type MarketSort = "Activity" | "Newest" | "Volume" | "MarketCap";
const MARKET_NETWORKS = [8453, 4663, 143, 988, 5042] as const;

const ReferenceWalletButton = dynamic(
  () => import("@/components/wallet-button").then((module) => module.WalletButton),
  { ssr: false, loading: () => <button className="button wallet-control" disabled type="button">Connect wallet</button> }
);

export function LaunchExplorer({ launches: initialLaunches, totalLaunches, chainId = 8453, initialQuery = "" }: { launches: DeployedLaunch[]; totalLaunches: number; chainId?: number; initialQuery?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [launches, setLaunches] = useState(initialLaunches);
  const [total, setTotal] = useState(totalLaunches);
  const [page, setPage] = useState(1);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<MarketCategory>("All");
  const [sort, setSort] = useState<MarketSort>("Activity");
  const [nativeUsdByChain, setNativeUsdByChain] = useState<Map<number, number | null>>(new Map());
  const [dexMarketCaps, setDexMarketCaps] = useState<Map<string, number>>(new Map());
  const [activityByLaunch, setActivityByLaunch] = useState<Map<string, LaunchBuyActivity>>(new Map());
  const [recentActivity, setRecentActivity] = useState<LaunchBuyActivity[]>([]);
  const [marketSparklines, setMarketSparklines] = useState<Map<string, MarketSparkline>>(new Map());
  const [hotLaunchKey, setHotLaunchKey] = useState<string>();
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [, startTransition] = useTransition();
  const tokensRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const activityBlocksRef = useRef<Map<string, bigint>>(new Map());
  const activityReadyRef = useRef(false);
  const allNetworks = chainId === 0;
  const activeNetwork = allNetworks ? { name: "All networks", symbol: "MULTI" } : networkMeta(chainId);
  const chainParam = allNetworks ? "all" : chainSlug(chainId);

  useEffect(() => {
    function closeNetworkMenu(event: PointerEvent) {
      if (!networkMenuRef.current?.contains(event.target as Node)) setNetworkMenuOpen(false);
    }
    function closeNetworkMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setNetworkMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeNetworkMenu);
    document.addEventListener("keydown", closeNetworkMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeNetworkMenu);
      document.removeEventListener("keydown", closeNetworkMenuOnEscape);
    };
  }, []);

  useEffect(() => {
    setLaunches(initialLaunches);
    setTotal(totalLaunches);
    setPage(1);
    setQuery(initialQuery);
    setCategory("All");
    setSort("Activity");
    setActivityByLaunch(new Map());
    setRecentActivity([]);
    setHotLaunchKey(undefined);
    activityBlocksRef.current = new Map();
    activityReadyRef.current = false;
  }, [chainId, initialLaunches, initialQuery, totalLaunches]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsPageLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams({ chain: chainParam, page: String(page), filter: category, sort });
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
  }, [category, chainId, chainParam, page, query, refreshNonce, sort]);

  useEffect(() => {
    let active = true;
    let activityLoading = false;
    let highlightTimer: number | undefined;
    const controller = new AbortController();

    async function loadActivity() {
      if (activityLoading) return;
      activityLoading = true;
      try {
        const networkIds = allNetworks ? MARKET_NETWORKS : [chainId];
        const payloads = await Promise.all(networkIds.map(async (networkId) => {
          const response = await fetch(`/api/launch-activity?chain=${chainSlug(networkId)}`, { signal: controller.signal });
          if (!response.ok) return [] as LaunchBuyActivity[];
          const payload = await response.json() as { activity?: LaunchBuyActivity[] };
          return payload.activity ?? [];
        }));
        if (!active) return;
        const items = payloads.flat().sort(compareActivityNewestFirst);
        const latestByLaunch = new Map<string, LaunchBuyActivity>();
        for (const item of items) {
          const key = activityKey(item);
          if (!latestByLaunch.has(key)) latestByLaunch.set(key, item);
        }
        const nextBlocks = new Map(Array.from(latestByLaunch, ([key, item]) => [key, safeBlockNumber(item.blockNumber)]));

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
        setActivityByLaunch(latestByLaunch);
        setRecentActivity(items);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // The launch feed remains usable if the lightweight activity pulse is unavailable.
        }
      } finally {
        activityLoading = false;
      }
    }

    loadActivity();
    activityRefreshRef.current = loadActivity;
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(highlightTimer);
      activityRefreshRef.current = undefined;
    };
  }, [allNetworks, chainId]);

  const activityRefreshRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const activityScopes = useMemo(() => new Set((allNetworks ? MARKET_NETWORKS : [chainId]).flatMap((networkId) => indexerScopesForChain(networkId).map((item) => item.scope))), [allNetworks, chainId]);
  const activityScopeFilter = useMemo(() => `scope=in.(${[...activityScopes].join(",")})`, [activityScopes]);
  useRealtimeRefresh({
    table: "trades",
    filter: activityScopeFilter,
    fallbackMs: 60_000,
    onRefresh: () => activityRefreshRef.current?.(),
    matches: (payload) => {
      const row = (payload.new || payload.old) as Record<string, unknown>;
      return row.side === "buy" && activityScopes.has(String(row.scope || ""));
    }
  });

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
      const networkIds = allNetworks ? MARKET_NETWORKS : [chainId];
      const prices = await Promise.all(networkIds.map(async (networkId) => {
        try {
          const response = await fetch(`/api/native-price?chain=${chainSlug(networkId)}`, { cache: "no-store" });
          const payload = await response.json() as { nativeUsd?: number | null };
          return [networkId, payload.nativeUsd ?? null] as const;
        } catch {
          return [networkId, null] as const;
        }
      }));
      if (active) setNativeUsdByChain(new Map(prices));
    }
    loadNativePrice();
    const interval = window.setInterval(loadNativePrice, 300_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [allNetworks, chainId]);

  const pulseItems = useMemo(() => {
    const launchesByKey = new Map(initialLaunches.map((launch) => [activityKey(launch), launch]));
    return recentActivity.flatMap((activity) => {
      const launch = launchesByKey.get(activityKey(activity));
      return launch ? [{ activity, launch }] : [];
    }).slice(0, 8);
  }, [initialLaunches, recentActivity]);
  const previewMode = initialLaunches.some(isUiPreviewLaunch);
  const totalPages = previewMode && !query && category === "All" ? Math.ceil(128 / MARKET_PAGE_SIZE) : Math.ceil(total / MARKET_PAGE_SIZE);
  const pagination = paginationItems(page, totalPages);
  // The API sorts the complete result set before pagination. Re-sorting only the
  // current page here would make page boundaries and the selected order disagree.
  const displayedLaunches = launches;
  const displayedLaunchKeys = useMemo(() => displayedLaunches.map(activityKey).join(","), [displayedLaunches]);

  useEffect(() => {
    if (!displayedLaunchKeys || previewMode) {
      setMarketSparklines(new Map());
      return;
    }
    const controller = new AbortController();
    const groups = groupLaunchesByChain(displayedLaunches);
    Promise.all([...groups].map(async ([networkId, rows]) => {
      const response = await fetch(`/api/market-sparklines?${new URLSearchParams({ chain: chainSlug(networkId), keys: rows.map(activityKey).join(",") })}`, { signal: controller.signal });
      if (!response.ok) return [] as MarketSparkline[];
      const payload = await response.json() as { sparklines?: MarketSparkline[] };
      return payload.sparklines ?? [];
    }))
      .then((items) => setMarketSparklines(new Map(items.flat().map((sparkline) => [`${sparkline.scope}:${sparkline.launchId}`, sparkline]))))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMarketSparklines(new Map());
      });
    return () => controller.abort();
  }, [displayedLaunchKeys, displayedLaunches, previewMode, refreshNonce]);

  return (
    <section className="explorer-shell reference-market-terminal">
      <header className="reference-market-header">
        <div className="reference-market-title"><BrandLaunchpadMenu/><h1>Markets</h1></div>
        <label className="reference-global-search">
          <Search size={17} />
          <input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search token, ticker or address" value={query} />
          <kbd>/</kbd>
        </label>
        <div className="reference-network-picker" ref={networkMenuRef}>
          <button
            aria-expanded={networkMenuOpen}
            aria-haspopup="menu"
            aria-label={`Market network: ${activeNetwork.name}`}
            className={`reference-network-select${allNetworks ? " all-networks" : ""}${networkMenuOpen ? " open" : ""}`}
            onClick={() => setNetworkMenuOpen((open) => !open)}
            type="button"
          >
            {allNetworks ? <AllNetworksIcon /> : <NetworkIcon chainId={chainId} size={18}/>}
            <span><small>Network</small><strong>{activeNetwork.name}</strong></span>
            <ChevronDown size={13}/>
          </button>
          {networkMenuOpen ? (
            <div className="reference-network-menu" role="menu" aria-label="Select market network">
              <header><span>Browse networks</span><small>Select a market feed</small></header>
              <button
                className={allNetworks ? "active" : ""}
                onClick={() => {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("chain", "all");
                  params.delete("page");
                  router.push(`/?${params.toString()}`);
                  setNetworkMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <AllNetworksIcon />
                <span><strong>All networks</strong><small>Combined market feed</small></span>
                {allNetworks ? <Check size={15}/> : null}
              </button>
              {MARKET_NETWORKS.map((networkId) => {
                const network = networkMeta(networkId);
                const active = chainId === networkId;
                return (
                  <button
                    className={active ? "active" : ""}
                    key={networkId}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set("chain", chainSlug(networkId));
                      params.delete("page");
                      router.push(`/?${params.toString()}`);
                      setNetworkMenuOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <NetworkIcon chainId={networkId} size={25}/>
                    <span><strong>{network.name}</strong><small>{network.symbol} markets</small></span>
                    {active ? <Check size={15}/> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <Link className="button primary reference-create-token" href={`/launch?chain=${allNetworks ? "base" : chainSlug(chainId)}`}><Rocket size={15}/>Create token <b>+</b></Link>
        <ReferenceWalletButton/>
      </header>

      <nav className="reference-category-bar" aria-label="Market categories">
        <label className="reference-sort-control">
          <span>Sort</span>
          <select
            aria-label="Sort markets"
            onChange={(event) => {
              setSort(event.target.value as MarketSort);
              setPage(1);
            }}
            value={sort}
          >
            <option value="Activity">Market activity</option>
            <option value="Newest">Newest</option>
            <option value="Volume">24h volume</option>
            <option value="MarketCap">Market cap</option>
          </select>
          <ChevronDown size={12}/>
        </label>
        <span>Categories</span>
        {([
          ["All", "All tokens"],
          ["Progress", "Bonding"],
          ["Direct", "Direct DEX"]
        ] as const).map(([value, label]) => (
          <button
            aria-pressed={category === value}
            className={category === value ? "active" : ""}
            key={value}
            onClick={() => {
              setCategory(value);
              setPage(1);
            }}
            type="button"
          >
            <i />{label}
          </button>
        ))}
      </nav>

      <div className="reference-market-body">
        <main className="reference-market-main" ref={tokensRef}>
          <div className="reference-market-scroll">
          {loadError ? <BlueFunState action={<button className="button compact" type="button" onClick={() => setRefreshNonce((value) => value + 1)}>Try again</button>} compact text="Showing the last successful market snapshot while the live feed reconnects." title="Market data is reconnecting" variant="offline" /> : null}
          {launches.length === 0 && !isPageLoading ? (
            <BlueFunState action={totalLaunches === 0 ? <Link className="button primary compact" href={`/launch?chain=${allNetworks ? "base" : chainSlug(chainId)}`}>Launch a token</Link> : null} text={totalLaunches === 0 ? "Create the first fair token and start the market." : "Try another search term or clear the search field."} title={totalLaunches === 0 ? allNetworks ? "No indexed markets yet" : `Be first on ${activeNetwork.name}` : "No matching launches"} variant="empty" />
          ) : (
          <div className={`reference-market-table${isPageLoading ? " page-loading" : ""}`} aria-busy={isPageLoading}>
            <div className="reference-market-table-head" aria-hidden="true">
              <span>Token</span><span>Network</span><span>Age</span><span>24h chart</span><span>Market cap</span><span>Liquidity</span><span>24h volume</span><span>Venue</span><span>Trade</span>
            </div>
            {displayedLaunches.map((launch, index) => {
            const direct = launch.launchMode === "direct";
            const previewRow = isUiPreviewLaunch(launch);
            const officialBlue = isOfficialBlue(launch);
            const key = activityKey(launch);
            const isHot = hotLaunchKey === key;
            const activity = activityByLaunch.get(key);
            const hasMarketCap = launch.marketCap.trim().toLowerCase() !== "live" && parseDisplayAmount(launch.marketCap) > 0;
            const indexedMarketCap = activity?.marketCapNative && parseDisplayAmount(activity.marketCapNative) > 0
              ? `${activity.marketCapNative} ${launchEconomics(launch.chainId).nativeSymbol}`
              : undefined;
            const dexMarketCap = dexMarketCaps.get(launch.token.toLowerCase());
            const marketCapNative = hasMarketCap ? launch.marketCap : indexedMarketCap ?? (direct ? "Live" : estimateCurveMarketCap(launch.raised, launch.chainId));
            const nativeUsd = nativeUsdByChain.get(launch.chainId) ?? null;
            const marketCap = previewRow ? launch.marketCap : dexMarketCap ? compactUsd(dexMarketCap) : formatLaunchUsd(marketCapNative, nativeUsd);
            const liquidity = previewRow ? launch.raised : direct || launch.status === "Graduated" ? "Locked" : formatLaunchUsd(launch.raised, nativeUsd);
            const volume = previewRow ? launch.volume : formatLaunchUsd(launch.volume, nativeUsd);
            const sparkline = marketSparklines.get(key);
            const tradeCount = (sparkline?.buys ?? 0) + (sparkline?.sells ?? 0);
            const positive = (sparkline?.changePercent ?? 0) >= 0;
            const venue: DexProvider | undefined = direct
              ? launch.dexProvider === "ekubo" ? "ekubo" : "uniswap"
              : launch.status === "Graduated" ? "uniswap" : undefined;
            return (
            <article className={`reference-market-row${isHot ? " activity-hot" : ""}`} key={`${launch.chainId}-${launch.id}-${launch.token}`}>
              <Link className="reference-token-cell" href={tokenPath(launch)}>
                <span className="reference-watch-star">☆</span><TokenAvatar launch={launch} hot={isHot || index === 0} />
                <span><strong>{launch.name}{officialBlue ? <em>Official</em> : null}</strong><small>${launch.symbol}</small></span>
              </Link>
              <span className="reference-chain-cell"><NetworkIcon chainId={launch.chainId} size={13}/>{networkMeta(launch.chainId).name}</span>
              <span className="reference-age-cell">{launch.age}</span>
              <Sparkline data={sparkline}/>
              <span className="reference-value-cell"><strong>{marketCap}</strong>{sparkline ? <small className={positive ? "positive" : "negative"}>{positive ? "↗" : "↘"} {Math.abs(sparkline.changePercent).toFixed(2)}% · 24h</small> : <small>Latest indexed value</small>}</span>
              <span className="reference-value-cell"><strong>{liquidity}</strong><small>{direct || launch.status === "Graduated" ? "LP liquidity" : `${launch.progress}% bonding`}</small></span>
              <span className="reference-value-cell"><strong>{volume}</strong><small>{tradeCount ? `${tradeCount} indexed trades` : "No 24h trades"}</small></span>
              <span className="reference-dex-cell">
                {venue ? <><DexProviderIcon provider={venue} size={22} /><span><strong>{venue === "ekubo" ? "Ekubo" : "Uniswap"}</strong><small>{direct ? "Direct · LP locked" : "Graduated pool"}</small></span></> : <><i className="reference-bond-dot" /><span><strong>Bonding</strong><small>Curve active</small></span></>}
              </span>
              <Link className="reference-buy-button" href={tokenPath(launch)}>Buy</Link>
            </article>
            );
          })}
          </div>
          )}
          </div>
          {totalPages > 1 ? (
            <nav className="launch-pagination reference-pagination" aria-label="Launch pages">
              <span>{total.toLocaleString("en-US")} tokens</span>
              <button disabled={page === 1 || isPageLoading} onClick={() => changePage(page - 1)} type="button" aria-label="Previous page">‹</button>
              {pagination.map((item, index) => item === "…" ? <span className="pagination-ellipsis" key={`ellipsis-${index}`}>…</span> : <button className={item === page ? "active" : ""} disabled={isPageLoading} onClick={() => changePage(item)} type="button" aria-current={item === page ? "page" : undefined} key={item}>{item}</button>)}
              <button disabled={page === totalPages || isPageLoading} onClick={() => changePage(page + 1)} type="button" aria-label="Next page">›</button>
            </nav>
          ) : null}
        </main>

        <aside className="reference-live-rail">
          <header><div><span>Live activity</span><small>Confirmed buys</small></div><Activity size={16}/></header>
          <div className="reference-live-list">
            {pulseItems.length ? pulseItems.map(({ activity, launch }, index) => {
              return <Link href={tokenPath(launch)} key={`live-${launch.chainId}-${activity.txHash || `${launch.id}-${activity.blockNumber}-${index}`}`}>
                <i/>
                <span><strong>{launch.symbol} bought</strong><small>{shortActivityAddress(activity.trader)}</small></span>
                <span><time>{formatActivityAge(activity.createdAt)}</time><b>{activity.nativeAmount || "Confirmed"}</b></span>
              </Link>;
            }) : <div className="reference-live-empty"><Zap size={16}/>Waiting for the next confirmed buy.</div>}
          </div>
        </aside>
      </div>

      <footer className="reference-status-bar">
        <div className="reference-market-summary">
          <span className="reference-summary-network">{allNetworks ? <AllNetworksIcon /> : <NetworkIcon chainId={chainId} size={14}/>}<strong>{activeNetwork.name}</strong></span>
          <span><small>Total markets</small><b>{total.toLocaleString("en-US")}</b></span>
          <span><small>On this page</small><b>{displayedLaunches.length}</b></span>
          <span><small>Category</small><b>{category === "All" ? "All tokens" : category === "Progress" ? "Bonding" : "Direct DEX"}</b></span>
          <span><small>Sort</small><b>{sort === "Activity" ? "Market activity" : sort === "Newest" ? "Newest" : sort === "Volume" ? "24h volume" : "Market cap"}</b></span>
        </div>
        <div className="reference-footer-tools">
          <span className="reference-search-shortcut"><kbd>/</kbd> Search</span>
          <span className="reference-page-status">Page <b>{page}</b> of <b>{Math.max(totalPages, 1)}</b></span>
        </div>
      </footer>
    </section>
  );

  function changePage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    if (safePage === page) return;
    setPage(safePage);
    window.requestAnimationFrame(() => tokensRef.current?.querySelector<HTMLElement>(".reference-market-scroll")?.scrollTo({ top: 0 }));
  }
}

function formatLaunchUsd(value: string, ethUsd: number | null) {
  if (value.trim().toLowerCase() === "live") return "Awaiting first trade";
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

function AllNetworksIcon() {
  return (
    <span className="reference-all-network-icon" aria-hidden="true">
      <svg viewBox="0 0 28 28">
        <circle className="all-network-orbit" cx="14" cy="14" r="8.25" />
        <path className="all-network-globe" d="M6.2 14h15.6M14 5.8c2.1 2.3 3.1 5.1 3.1 8.2s-1 5.9-3.1 8.2M14 5.8c-2.1 2.3-3.1 5.1-3.1 8.2s1 5.9 3.1 8.2" />
        <circle className="all-network-node node-one" cx="5.2" cy="8" r="2" />
        <circle className="all-network-node node-two" cx="22.8" cy="9.2" r="1.7" />
        <circle className="all-network-node node-three" cx="20.8" cy="21.6" r="1.6" />
      </svg>
    </span>
  );
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

function compareActivityNewestFirst(left: LaunchBuyActivity, right: LaunchBuyActivity) {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
  return compareBlocks(right.blockNumber, left.blockNumber);
}

function shortActivityAddress(address?: string) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Onchain buyer";
}

function Sparkline({ data }: { data?: MarketSparkline }) {
  if (!data || data.points.length < 2) {
    return <span className="reference-sparkline-empty" aria-label="No indexed 24 hour chart data">No 24h data</span>;
  }
  const min = Math.min(...data.points);
  const max = Math.max(...data.points);
  const range = Math.max(max - min, Math.abs(max) * 0.002, 0.000000001);
  const points = data.points.map((point, index) => {
    const x = index / (data.points.length - 1) * 110;
    const y = 34 - (point - min) / range * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const positive = data.changePercent >= 0;
  return (
    <svg className={`reference-sparkline ${positive ? "positive" : "negative"}`} viewBox="0 0 110 40" role="img" aria-label={`${positive ? "Positive" : "Negative"} indexed 24 hour market-cap trend`}>
      <polyline points={points} />
      <circle cx={points.split(" ").at(-1)?.split(",")[0]} cy={points.split(" ").at(-1)?.split(",")[1]} r="2.2"/>
    </svg>
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

function activityKey(item: Pick<LaunchBuyActivity, "scope" | "launchId"> | Pick<DeployedLaunch, "scope" | "id" | "chainId">) {
  const launchId = "launchId" in item ? item.launchId : item.id;
  const scope = item.scope ?? ("chainId" in item ? indexerScopesForChain(item.chainId)[0] : "");
  return `${scope}:${launchId}`;
}

function paginationItems(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2].filter((value) => value >= 1 && value <= total));
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: Array<number | "…"> = [];
  for (const value of sorted) {
    const previous = result.at(-1);
    if (typeof previous === "number" && value - previous > 1) result.push("…");
    result.push(value);
  }
  return result;
}

function groupLaunchesByChain(launches: DeployedLaunch[]) {
  const groups = new Map<number, DeployedLaunch[]>();
  for (const launch of launches) {
    const rows = groups.get(launch.chainId) ?? [];
    rows.push(launch);
    groups.set(launch.chainId, rows);
  }
  return groups;
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
          <div className={`token-symbol-art token-symbol-${launch.symbol.toLowerCase()}`}>
            {launch.symbol === "SPARK" ? "ϟ" : launch.symbol === "SHIBASE" ? "S" : launch.symbol === "NINI" ? "●" : launch.symbol.slice(0, 4)}
          </div>
          <div className="spark" />
        </>
      )}
    </div>
  );
}
