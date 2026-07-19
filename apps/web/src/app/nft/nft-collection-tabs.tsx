"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownToLine, BarChart3, ExternalLink, Gavel, Images, Loader2, ShoppingBag, Tag, WalletCards } from "lucide-react";
import { formatEther } from "viem";

type ActivityRow = { id: string; type: "mint" | "listing" | "sale" | "transfer"; tokenId: string; quantity: string; amount?: string; wallet?: string; counterparty?: string; txHash?: string; createdAt: string };
type ActivityPayload = { activity: ActivityRow[]; summary: { floorPrice: string | null; totalVolume: string; sales: number; mints: number; listed: number } };

export function NFTCollectionTabs({ collection, children, offers }: { collection: string; children: React.ReactNode; offers?: React.ReactNode }) {
  const [tab, setTab] = useState<"items" | "offers" | "activity" | "analytics">("items");
  const [payload, setPayload] = useState<ActivityPayload>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab === "items" || tab === "offers" || payload) return;
    setLoading(true);
    fetch(`/api/nft/activity?collection=${collection}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Activity unavailable"))).then(setPayload).catch(() => setPayload({ activity: [], summary: { floorPrice: null, totalVolume: "0", sales: 0, mints: 0, listed: 0 } })).finally(() => setLoading(false));
  }, [collection, payload, tab]);

  return <section className="nft-collection-workspace">
    <nav aria-label="Collection views"><button className={tab === "items" ? "active" : ""} onClick={() => setTab("items")}><Images/>Items</button>{offers ? <button className={tab === "offers" ? "active" : ""} onClick={() => setTab("offers")}><Gavel/>Offers</button> : null}<button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><Activity/>Activity</button><button className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}><BarChart3/>Analytics</button></nav>
    {tab === "items" ? children : tab === "offers" ? offers : loading ? <div className="nft-collection-loading"><Loader2 className="spin"/>Loading indexed collection data…</div> : tab === "activity" ? <ActivityView rows={payload?.activity || []}/> : <AnalyticsView summary={payload?.summary}/>}
  </section>;
}

function ActivityView({ rows }: { rows: ActivityRow[] }) {
  if (!rows.length) return <div className="nft-directory-panel nft-activity-empty"><Activity/><h3>No indexed activity yet</h3><p>Mints, listings, transfers and marketplace sales will appear here after confirmation.</p></div>;
  return <section className="nft-directory-panel nft-activity-panel"><header><div><span>ONCHAIN HISTORY</span><h2>Collection activity</h2></div><strong>{rows.length} EVENTS</strong></header><div>{rows.map((row) => <article key={row.id}><span className={row.type}>{activityIcon(row.type)}</span><div><strong>{activityLabel(row.type)} · Token #{row.tokenId}</strong><small>{row.quantity !== "1" ? `${row.quantity} items · ` : ""}{row.wallet ? shortAddress(row.wallet) : "Onchain"}{row.counterparty ? ` → ${shortAddress(row.counterparty)}` : ""}</small></div>{row.amount ? <b>{formatWei(row.amount)} ETH</b> : <time>{formatAge(row.createdAt)}</time>}{row.txHash ? <a aria-label="View transaction" href={`https://basescan.org/tx/${row.txHash}`} target="_blank" rel="noreferrer"><ExternalLink/></a> : null}</article>)}</div></section>;
}

function AnalyticsView({ summary }: { summary?: ActivityPayload["summary"] }) {
  const stats = useMemo(() => [
    ["Floor price", summary?.floorPrice ? `${formatWei(summary.floorPrice)} ETH` : "—"],
    ["Total volume", `${formatWei(summary?.totalVolume || "0")} ETH`],
    ["Sales", String(summary?.sales || 0)],
    ["Primary mints", String(summary?.mints || 0)],
    ["Active listings", String(summary?.listed || 0)]
  ], [summary]);
  return <section className="nft-directory-panel nft-analytics-panel"><header><div><span>INDEXED MARKET DATA</span><h2>Collection analytics</h2><p>Live BlueFun primary mint and secondary marketplace data on Base.</p></div></header><div>{stats.map(([label, value]) => <article key={label}><small>{label}</small><strong>{value}</strong></article>)}</div><p><BarChart3/>Historical charts will activate as the collection accumulates enough confirmed sales.</p></section>;
}

function activityIcon(type: ActivityRow["type"]) { return type === "mint" ? <ArrowDownToLine/> : type === "listing" ? <Tag/> : type === "sale" ? <ShoppingBag/> : <WalletCards/>; }
function activityLabel(type: ActivityRow["type"]) { return type === "mint" ? "Mint" : type === "listing" ? "Listed" : type === "sale" ? "Sale" : "Transfer"; }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function formatWei(value: string) { try { return Number(formatEther(BigInt(value))).toLocaleString("en-US", { maximumFractionDigits: 4 }); } catch { return "0"; } }
function formatAge(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; }
