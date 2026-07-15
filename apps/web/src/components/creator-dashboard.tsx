"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, zeroAddress } from "viem";
import { useAccount, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { ArrowUpRight, BarChart3, Coins, ExternalLink, Flame, Layers3, Loader2, LockKeyhole, RefreshCw, Rocket, Sparkles, Wallet, WalletCards } from "lucide-react";
import { NetworkIcon, networkMeta } from "@/components/network-icon";
import { b20TokenAbi, bondingCurveAbi, deploymentsForChain, feeSharingLockerAbi, indexerScopeForDeployment, isVNextLiquidityLocker, unifiedFeeHookAbi } from "@/lib/contracts";
import type { WalletDashboardData, WalletTradeSummary } from "@/lib/dashboard-types";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";
import { tokenPath } from "@/lib/token-url";

type DashboardTab = "overview" | "launches" | "holdings";
type ActionState = { key: string; message?: string; error?: string };

export function CreatorDashboard() {
  const { address, isConnected } = useAccount();
  const [data, setData] = useState<WalletDashboardData>({ created: [], traded: [], indexed: true });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [action, setAction] = useState<ActionState>({ key: "" });

  async function loadDashboard(signal?: AbortSignal) {
    if (!address) {
      setData({ created: [], traded: [], indexed: true });
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/dashboard?wallet=${address}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Dashboard data could not be loaded.");
      setData(await response.json() as WalletDashboardData);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setLoadError(error instanceof Error ? error.message : "Dashboard data could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setData({ created: [], traded: [], indexed: true });
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  const feeSources = useMemo(() => {
    const seen = new Set<string>();
    return data.created.flatMap((launch) => {
      if (launch.launchMode === "direct") return [];
      const deployment = deploymentsForChain(launch.chainId)
        .find((candidate) => launch.scope === indexerScopeForDeployment(launch.chainId, candidate));
      if (!deployment) return [];
      const key = `${launch.chainId}:${deployment.bondingCurveMarket.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        chainId: launch.chainId,
        address: deployment.bondingCurveMarket,
        label: `${networkMeta(launch.chainId).name} · ${deployment.version}`
      }];
    });
  }, [data.created]);

  const lockerSources = useMemo(() => {
    const seen = new Set<string>();
    return data.created.flatMap((launch) => {
      if (!launch.liquidityLocker || isVNextLiquidityLocker(launch.chainId, launch.liquidityLocker)) return [];
      const key = `${launch.chainId}:${launch.liquidityLocker.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ chainId: launch.chainId, address: launch.liquidityLocker }];
    });
  }, [data.created]);

  const hookSources = useMemo(() => {
    const seen = new Set<string>();
    return data.created.flatMap((launch) => {
      const deployment = deploymentsForChain(launch.chainId).find((candidate) => {
        if (candidate.version !== "vnext" || !candidate.feeHook) return false;
        if (launch.launchMode === "direct") {
          return Boolean(candidate.directLaunchFactory && launch.scope?.includes(candidate.directLaunchFactory.toLowerCase()));
        }
        return launch.scope === indexerScopeForDeployment(launch.chainId, candidate);
      });
      if (!deployment?.feeHook) return [];
      const key = `${launch.chainId}:${deployment.feeHook.toLowerCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ chainId: launch.chainId, address: deployment.feeHook }];
    });
  }, [data.created]);

  const bondFees = useReadContracts({
    contracts: feeSources.map((source) => ({ chainId: source.chainId, address: source.address, abi: bondingCurveAbi, functionName: "pendingFees", args: [address!] })),
    query: { enabled: Boolean(address && feeSources.length) }
  });
  const lockerNativeFees = useReadContracts({
    contracts: lockerSources.map((source) => ({ chainId: source.chainId, address: source.address, abi: feeSharingLockerAbi, functionName: "pendingFees", args: [address!, zeroAddress] })),
    query: { enabled: Boolean(address && lockerSources.length) }
  });
  const hookCreatorFees = useReadContracts({
    contracts: hookSources.map((source) => ({ chainId: source.chainId, address: source.address, abi: unifiedFeeHookAbi, functionName: "pendingCreatorRevenue", args: [address!] })),
    query: { enabled: Boolean(address && hookSources.length) }
  });
  const balances = useReadContracts({
    contracts: data.traded.map(({ launch }) => ({ chainId: launch.chainId, address: launch.token, abi: b20TokenAbi, functionName: "balanceOf", args: [address!] })),
    query: { enabled: Boolean(address && data.traded.length) }
  });
  const revenueLaunches = useMemo(() => data.created.filter((launch) => launch.positionId && launch.liquidityLocker && !isVNextLiquidityLocker(launch.chainId, launch.liquidityLocker)), [data.created]);
  const feeRevenue = useReadContracts({
    contracts: revenueLaunches.map((launch) => ({ chainId: launch.chainId, address: launch.liquidityLocker!, abi: feeSharingLockerAbi, functionName: "feeRevenue", args: [launch.positionId!] })),
    query: { enabled: Boolean(revenueLaunches.length) }
  });
  const tokenPending = useReadContracts({
    contracts: revenueLaunches.map((launch) => ({ chainId: launch.chainId, address: launch.liquidityLocker!, abi: feeSharingLockerAbi, functionName: "pendingFees", args: [address!, launch.token] })),
    query: { enabled: Boolean(address && revenueLaunches.length) }
  });

  const holdings = useMemo(() => data.traded.flatMap((summary, index) => {
    const balance = balances.data?.[index]?.result as bigint | undefined;
    return balance && balance > 0n ? [{ ...summary, balance }] : [];
  }), [balances.data, data.traded]);
  const pendingBond = sumReadResults(bondFees.data);
  const pendingLpNative = sumReadResults(lockerNativeFees.data);
  const pendingHookCreator = sumReadResults(hookCreatorFees.data);
  const totalPending = pendingBond + pendingLpNative + pendingHookCreator;
  const totalVolume = data.created.reduce((sum, launch) => sum + parseDisplayEth(launch.volume), 0);

  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  async function submitAction(key: string, chainId: number, request: Parameters<typeof writeContractAsync>[0]) {
    setAction({ key });
    try {
      await switchChainAsync({ chainId: chainId as 8453 | 4663 });
      const hash = await writeContractAsync(request);
      setAction({ key: "", message: `Transaction submitted · ${shortAddress(hash)}` });
      window.setTimeout(() => {
        void bondFees.refetch();
        void lockerNativeFees.refetch();
        void hookCreatorFees.refetch();
        void feeRevenue.refetch();
        void tokenPending.refetch();
      }, 5000);
    } catch (error) {
      setAction({ key: "", error: friendlyWalletError(error) });
    }
  }

  if (!isConnected || !address) return <DisconnectedDashboard />;

  return (
    <div className="creator-dashboard">
      <header className="dashboard-hero">
        <div>
          <span className="dashboard-eyebrow"><Sparkles size={14} /> Wallet command desk</span>
          <h1>Your launch desk.<br /><span>No noise, just positions.</span></h1>
          <p>Markets issued, fees earned and assets held across both networks.</p>
        </div>
        <div className="dashboard-wallet-card">
          <span>Connected wallet</span>
          <strong>{shortAddress(address)}</strong>
          <div><i /> Live onchain data</div>
        </div>
      </header>

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        {(["overview", "launches", "holdings"] as DashboardTab[]).map((item) => (
          <button aria-current={tab === item ? "page" : undefined} key={item} onClick={() => setTab(item)} type="button">
            {item === "overview" ? "Overview" : item === "launches" ? `My launches (${data.created.length})` : `Holdings (${holdings.length})`}
          </button>
        ))}
        <button className="dashboard-refresh" disabled={loading} onClick={() => void loadDashboard()} type="button" aria-label="Refresh dashboard">
          <RefreshCw className={loading ? "spin" : ""} size={15} />
        </button>
      </nav>

      {loadError ? <div className="dashboard-notice error">{loadError}</div> : null}
      {!data.indexed ? <div className="dashboard-notice">Indexer data is temporarily unavailable. Onchain fee balances remain visible.</div> : null}
      {action.message ? <div className="dashboard-notice success">{action.message}</div> : null}
      {action.error ? <div className="dashboard-notice error">{action.error}</div> : null}

      {tab === "overview" ? (
        <>
          <section className="dashboard-stat-grid" aria-label="Portfolio summary">
            <StatCard icon={<Rocket />} label="Tokens launched" value={String(data.created.length)} detail={`${countNetworks(data.created)} network${countNetworks(data.created) === 1 ? "" : "s"}`} />
            <StatCard icon={<WalletCards />} label="Tokens held" value={String(holdings.length)} detail="Bought on BlueFun" />
            <StatCard icon={<Coins />} label="Claimable now" value={`${formatNative(totalPending)} ETH`} detail="Exact onchain balance" accent />
            <StatCard icon={<BarChart3 />} label="Creator volume" value={`${compactNumber(totalVolume)} ETH`} detail="Across your launches" />
          </section>

          <section className={`dashboard-overview-grid${data.created.length ? "" : " single"}`}>
            {data.created.length ? <div className="dashboard-panel earnings-panel">
              <PanelHeading icon={<Coins size={17} />} eyebrow="Creator revenue" title="Fee earnings" detail="Balances are read directly from each contract." />
              <div className="earnings-total"><span>Ready to claim</span><strong>{formatNative(totalPending)} ETH</strong></div>
              <div className="earnings-list">
                {feeSources.map((source, index) => {
                  const amount = readBigInt(bondFees.data?.[index]);
                  if (amount === 0n) return null;
                  const key = `bond:${source.chainId}:${source.address}`;
                  return <FeeRow key={key} chainId={source.chainId} label="Bond creator fees" detail={source.label} amount={`${formatNative(amount)} ETH`} pending={action.key === key} onClaim={() => submitAction(key, source.chainId, { chainId: source.chainId, address: source.address, abi: bondingCurveAbi, functionName: "claimFees" })} />;
                })}
                {lockerSources.map((source, index) => {
                  const amount = readBigInt(lockerNativeFees.data?.[index]);
                  if (amount === 0n) return null;
                  const key = `locker:${source.chainId}:${source.address}`;
                  return <FeeRow key={key} chainId={source.chainId} label="DEX LP fees" detail="Creator share · native currency" amount={`${formatNative(amount)} ETH`} pending={action.key === key} onClaim={() => submitAction(key, source.chainId, { chainId: source.chainId, address: source.address, abi: feeSharingLockerAbi, functionName: "claimFees", args: [zeroAddress] })} />;
                })}
                {hookSources.map((source, index) => {
                  const amount = readBigInt(hookCreatorFees.data?.[index]);
                  if (amount === 0n) return null;
                  const key = `hook:${source.chainId}:${source.address}`;
                  return <FeeRow key={key} chainId={source.chainId} label="Creator buy fees" detail="vNext · ETH" amount={`${formatNative(amount)} ETH`} pending={action.key === key} onClaim={() => submitAction(key, source.chainId, { chainId: source.chainId, address: source.address, abi: unifiedFeeHookAbi, functionName: "claimCreatorRevenue", args: [address] })} />;
                })}
                {totalPending === 0n ? <EmptyCompact icon={<LockKeyhole size={19} />} title="No fees ready yet" text="New creator fees will appear here as trades happen." /> : null}
              </div>
            </div> : null}

            <div className="dashboard-panel recent-panel">
              <PanelHeading icon={<Layers3 size={17} />} eyebrow="Issue log" title="Recent launches" detail="Newest markets from this wallet." />
              <div className="compact-token-list">
                {data.created.slice(0, 4).map((launch) => <CompactLaunch key={`${launch.chainId}:${launch.scope}:${launch.id}`} launch={launch} />)}
                {!loading && !data.created.length ? <EmptyCompact icon={<Rocket size={19} />} title="No launches yet" text="Create your first token in a few steps." action={<Link href="/launch">Create token <ArrowUpRight size={13} /></Link>} /> : null}
                {loading && !data.created.length ? <LoadingRows /> : null}
              </div>
              {data.created.length > 4 ? <button className="panel-text-button" onClick={() => setTab("launches")} type="button">View all launches <ArrowUpRight size={14} /></button> : null}
            </div>
          </section>
        </>
      ) : null}

      {tab === "launches" ? (
        <section className="dashboard-panel dashboard-full-panel">
          <PanelHeading icon={<Rocket size={17} />} eyebrow="Issued markets" title="My launches" detail="Performance and fee revenue by token." />
          {loading && !data.created.length ? <LoadingRows /> : null}
          {!loading && !data.created.length ? <EmptyLarge icon={<Rocket />} title="Your first launch starts here" text="Choose a bonding curve or launch directly into a locked Uniswap v4 pool." action={<Link className="button primary" href="/launch">Create a token</Link>} /> : null}
          <div className="launch-dashboard-grid">
            {data.created.map((launch) => {
              const revenueIndex = revenueLaunches.findIndex((item) => item.chainId === launch.chainId && item.positionId === launch.positionId);
              const revenue = revenueIndex >= 0 ? feeRevenue.data?.[revenueIndex]?.result as readonly bigint[] | undefined : undefined;
              const pendingTokenAmount = revenueIndex >= 0 ? readBigInt(tokenPending.data?.[revenueIndex]) : 0n;
              const key = `collect:${launch.chainId}:${launch.positionId}`;
              const claimTokenKey = `claim-token:${launch.chainId}:${launch.token}`;
              const vNext = isVNextLiquidityLocker(launch.chainId, launch.liquidityLocker);
              return <LaunchDashboardCard key={`${launch.chainId}:${launch.scope}:${launch.id}`} launch={launch} creatorNative={revenue?.[4] ?? 0n} creatorToken={revenue?.[5] ?? 0n} totalBurned={revenue?.[1] ?? 0n} pendingToken={pendingTokenAmount} collecting={action.key === key} claimingToken={action.key === claimTokenKey} onCollect={!vNext && launch.positionId && launch.liquidityLocker ? () => submitAction(key, launch.chainId, { chainId: launch.chainId, address: launch.liquidityLocker!, abi: feeSharingLockerAbi, functionName: "collectFees", args: [launch.positionId!] }) : undefined} onClaimToken={!vNext && pendingTokenAmount > 0n && launch.liquidityLocker ? () => submitAction(claimTokenKey, launch.chainId, { chainId: launch.chainId, address: launch.liquidityLocker!, abi: feeSharingLockerAbi, functionName: "claimFees", args: [launch.token] }) : undefined} />;
            })}
          </div>
        </section>
      ) : null}

      {tab === "holdings" ? (
        <section className="dashboard-panel dashboard-full-panel">
          <PanelHeading icon={<WalletCards size={17} />} eyebrow="Wallet inventory" title="Tokens you hold" detail="Current balances from BlueFun markets." />
          {balances.isLoading && data.traded.length ? <LoadingRows /> : null}
          {!balances.isLoading && !holdings.length ? <EmptyLarge icon={<Wallet />} title="No BlueFun holdings found" text="Tokens you buy on the platform will be tracked here automatically." action={<Link className="button primary" href="/">Explore tokens</Link>} /> : null}
          <div className="holdings-list">
            {holdings.map((holding) => <HoldingRow key={`${holding.launch.chainId}:${holding.launch.scope}:${holding.launch.id}`} holding={holding} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DisconnectedDashboard() {
  return <div className="creator-dashboard disconnected-dashboard"><section><div className="dashboard-connect-icon"><WalletCards size={30} /></div><span className="dashboard-eyebrow">Wallet index / private view</span><h1>One wallet.<br /><span>Every position.</span></h1><p>Issued markets, creator revenue and held tokens — indexed across Base and Robinhood.</p><ConnectButton.Custom>{({ mounted, openConnectModal }) => <button className="button primary" disabled={!mounted} onClick={openConnectModal} type="button"><Wallet size={17} /> Connect wallet</button>}</ConnectButton.Custom><div className="dashboard-connect-proof"><span><LockKeyhole size={14} /> No custody</span><span><Layers3 size={14} /> Two networks</span></div></section></div>;
}

function StatCard({ accent, detail, icon, label, value }: { accent?: boolean; detail: string; icon: React.ReactNode; label: string; value: string }) {
  return <article className={accent ? "dashboard-stat accent" : "dashboard-stat"}><div className="dashboard-stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function PanelHeading({ detail, eyebrow, icon, title }: { detail: string; eyebrow: string; icon: React.ReactNode; title: string }) {
  return <header className="dashboard-panel-heading"><div className="dashboard-panel-icon">{icon}</div><div><span>{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div></header>;
}

function FeeRow({ amount, chainId, detail, label, onClaim, pending }: { amount: string; chainId: number; detail: string; label: string; onClaim: () => void; pending: boolean }) {
  return <div className="fee-row"><NetworkIcon chainId={chainId} size={31} /><div><strong>{label}</strong><span>{detail}</span></div><b>{amount}</b><button disabled={pending} onClick={onClaim} type="button">{pending ? <Loader2 className="spin" size={14} /> : null} Claim</button></div>;
}

function CompactLaunch({ launch }: { launch: DeployedLaunch }) {
  return <Link className="compact-token" href={tokenPath(launch)}><TokenAvatar launch={launch} /><div><strong>{launch.name}</strong><span>${launch.symbol} · {launch.launchMode === "direct" ? "Direct DEX" : "Bond"}</span></div><div className="compact-token-value"><strong>{launch.volume}</strong><span>Volume</span></div><NetworkIcon chainId={launch.chainId} size={20} /></Link>;
}

function LaunchDashboardCard({ claimingToken, collecting, creatorNative, creatorToken, launch, onClaimToken, onCollect, pendingToken, totalBurned }: { claimingToken: boolean; collecting: boolean; creatorNative: bigint; creatorToken: bigint; launch: DeployedLaunch; onClaimToken?: () => void; onCollect?: () => void; pendingToken: bigint; totalBurned: bigint }) {
  const feeBurnModel = launch.poolFee === 0x800000;
  const vNext = isVNextLiquidityLocker(launch.chainId, launch.liquidityLocker);
  return <article className="launch-dashboard-card"><header><TokenAvatar launch={launch} /><div><Link href={tokenPath(launch)}>{launch.name} <ExternalLink size={12} /></Link><span>${launch.symbol}</span></div><NetworkIcon chainId={launch.chainId} size={24} /></header><div className="launch-card-badges"><span className="status">{launch.status}</span><span>{launch.launchMode === "direct" ? "Direct DEX" : "Bond curve"}</span>{launch.positionId ? <span className="locked"><LockKeyhole size={11} /> LP locked</span> : null}</div><div className="launch-card-metrics"><div><span>Volume</span><strong>{launch.volume}</strong></div><div><span>{launch.launchMode === "bond" ? "Bond progress" : "Trade fee"}</span><strong>{launch.launchMode === "bond" ? `${launch.progress}%` : feeBurnModel ? "1% directional" : `${(launch.poolFee ?? 10000) / 10000}%`}</strong></div></div>{launch.launchMode === "bond" && launch.status !== "Graduated" ? <div className="dashboard-progress"><span style={{ width: `${Math.min(100, launch.progress)}%` }} /></div> : null}{launch.positionId ? <div className="launch-fee-box"><span>{vNext ? "Automatic fee routing" : feeBurnModel ? "Creator earnings" : "Your collected LP earnings"}</span><strong>{vNext ? "Buy fees appear in Overview" : <>{formatNative(creatorNative)} ETH {!feeBurnModel ? <small>+ {formatTokenAmount(creatorToken)} ${launch.symbol}</small> : null}</>}</strong>{feeBurnModel && !vNext ? <div className="launch-burn-summary"><Flame size={13} /><span>Total burned</span><strong>{formatTokenAmount(totalBurned)} {launch.symbol}</strong></div> : null}{vNext ? <em>Creator ETH and sell burns are recorded during each trade. No sync is required.</em> : feeBurnModel ? <em>Collects new ETH earnings and burns accrued sell fees. Anyone can trigger it.</em> : null}{!feeBurnModel && pendingToken > 0n ? <em>{formatTokenAmount(pendingToken)} ${launch.symbol} ready to claim</em> : null}<div className="launch-fee-actions">{onCollect ? <button disabled={collecting} onClick={onCollect} title={feeBurnModel ? "Collects new creator ETH earnings and sends accrued sell-token fees to the burn address." : "Moves newly accrued Uniswap LP fees into your claimable dashboard balance."} type="button">{collecting ? <Loader2 className="spin" size={13} /> : feeBurnModel ? <Flame size={13} /> : <RefreshCw size={13} />} {feeBurnModel ? "Collect earnings & burn" : "Update earnings"}</button> : null}{!feeBurnModel && onClaimToken ? <button disabled={claimingToken} onClick={onClaimToken} type="button">{claimingToken ? <Loader2 className="spin" size={13} /> : <Coins size={13} />} Claim ${launch.symbol}</button> : null}</div></div> : <div className="launch-fee-box muted"><span>Creator fees</span><strong>Bond fees appear in Overview</strong></div>}<Link className="launch-card-link" href={tokenPath(launch)}>Open token page <ArrowUpRight size={14} /></Link></article>;
}

function HoldingRow({ holding }: { holding: WalletTradeSummary & { balance: bigint } }) {
  const { launch } = holding;
  return <Link className="holding-row" href={tokenPath(launch)}><TokenAvatar launch={launch} /><div className="holding-identity"><strong>{launch.name}</strong><span>${launch.symbol} · {shortAddress(launch.token)}</span></div><div className="holding-balance"><span>Current balance</span><strong>{formatTokenAmount(holding.balance)} {launch.symbol}</strong></div><div className="holding-activity"><span>BlueFun activity</span><strong>{holding.buyCount} buy{holding.buyCount === 1 ? "" : "s"} · {holding.sellCount} sell{holding.sellCount === 1 ? "" : "s"}</strong></div><NetworkIcon chainId={launch.chainId} size={24} /><ArrowUpRight className="holding-arrow" size={16} /></Link>;
}

function TokenAvatar({ launch }: { launch: DeployedLaunch }) {
  const [failed, setFailed] = useState(false);
  return <div className="dashboard-token-avatar">{launch.imageURI && !failed ? <img alt="" decoding="async" loading="lazy" onError={() => setFailed(true)} src={optimizedTokenImageUrl(launch.imageURI)} /> : <span>{launch.symbol.slice(0, 3)}</span>}</div>;
}

function EmptyCompact({ action, icon, text, title }: { action?: React.ReactNode; icon: React.ReactNode; text: string; title: string }) {
  return <div className="dashboard-empty compact"><div>{icon}</div><strong>{title}</strong><span>{text}</span>{action}</div>;
}

function EmptyLarge({ action, icon, text, title }: { action: React.ReactNode; icon: React.ReactNode; text: string; title: string }) {
  return <div className="dashboard-empty large"><div>{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function LoadingRows() { return <div className="dashboard-loading"><span /><span /><span /></div>; }

function readBigInt(result: { result?: unknown; status?: string } | undefined) { return result?.status === "success" && typeof result.result === "bigint" ? result.result : 0n; }
function sumReadResults(results: readonly { result?: unknown; status?: string }[] | undefined) { return results?.reduce((sum, result) => sum + readBigInt(result), 0n) ?? 0n; }
function parseDisplayEth(value: string) { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : 0; }
function formatNative(value: bigint) { const numeric = Number(formatEther(value)); if (!numeric) return "0"; if (numeric < 0.0001) return "<0.0001"; return numeric.toLocaleString(undefined, { maximumFractionDigits: 5 }); }
function formatTokenAmount(value: bigint) { const numeric = Number(formatUnits(value, 18)); if (numeric === 0) return "0"; if (numeric < 0.0001) return "<0.0001"; return numeric.toLocaleString(undefined, { maximumFractionDigits: numeric >= 1_000_000 ? 0 : 4, notation: numeric >= 1_000_000_000 ? "compact" : "standard" }); }
function compactNumber(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 3 : 1, notation: value >= 1000 ? "compact" : "standard" }); }
function countNetworks(launches: DeployedLaunch[]) { return new Set(launches.map((launch) => launch.chainId)).size; }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function friendlyWalletError(error: unknown) { const message = error instanceof Error ? error.message : String(error); if (/rejected|denied/i.test(message)) return "Transaction was cancelled in your wallet."; return message.split("\n")[0]?.slice(0, 180) || "Transaction could not be submitted."; }
