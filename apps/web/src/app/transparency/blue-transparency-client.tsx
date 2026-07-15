"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Copy, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import type { BlueTransparencyData } from "@/lib/blue-transparency";
import { BlueStakingPanel } from "@/components/blue-staking-panel";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const blueExplorerUrl = (address: string) => `https://basescan.org/address/${address}`;
const blueAddressLabel = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function quantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? compact.format(parsed) : "—";
}

function DistributionChart({ data }: { data: BlueTransparencyData }) {
  const creator = data.allocations.find((item) => item.id === "creator");
  const burn = data.allocations.find((item) => item.id === "burn");
  const holders = data.allocations.find((item) => item.id === "holders");
  const creatorPercent = creator?.percent ?? 0;
  const burnPercent = burn?.percent ?? 0;
  const holderPercent = holders?.percent ?? 0;
  const bubbleScale = 165;
  const holderRadius = Math.sqrt(holderPercent / 100) * bubbleScale;
  const creatorRadius = Math.sqrt(creatorPercent / 100) * bubbleScale;
  const burnRadius = burnPercent > 0 ? Math.sqrt(burnPercent / 100) * bubbleScale : 0;
  const allocations = [
    { id: "public", label: "Other wallets", percent: holderPercent, balance: holders?.balance || "0" },
    { id: "creator", label: "Creator wallet", percent: creatorPercent, balance: creator?.balance || "0", address: data.launch.creator },
    { id: "burn", label: "Burned", percent: burnPercent, balance: burn?.balance || "0", address: burn?.address }
  ];

  return <div className="blue-bubble-chart" aria-label="Live BLUE token distribution">
    <div className="blue-bubble-stage">
      <div className="blue-bubble-total"><span>Total supply</span><strong>{quantity(data.totalSupply)}</strong><small>BLUE</small></div>
      <svg viewBox="0 0 760 410" role="img" aria-label={`${creatorPercent.toFixed(2)} percent creator, ${burnPercent.toFixed(2)} percent burned, ${holderPercent.toFixed(2)} percent other wallets`}>
        <defs>
          <radialGradient id="blueHolderBubble" cx="31%" cy="22%" r="78%" fx="25%" fy="16%"><stop offset="0" stopColor="#d9ffff" /><stop offset=".1" stopColor="#68e8e0" /><stop offset=".4" stopColor="#2f9dff" /><stop offset=".74" stopColor="#285ee2" /><stop offset="1" stopColor="#112b89" /></radialGradient>
          <radialGradient id="blueCreatorBubble" cx="30%" cy="22%" r="78%" fx="24%" fy="15%"><stop offset="0" stopColor="#fff" /><stop offset=".15" stopColor="#cbd6ff" /><stop offset=".55" stopColor="#718cff" /><stop offset="1" stopColor="#3449b7" /></radialGradient>
          <radialGradient id="blueBurnBubble" cx="30%" cy="22%" r="78%" fx="24%" fy="15%"><stop offset="0" stopColor="#fff7de" /><stop offset=".16" stopColor="#ffd194" /><stop offset=".58" stopColor="#ff8d66" /><stop offset="1" stopColor="#b9353d" /></radialGradient>
          <radialGradient id="blueSphereDepth" cx="38%" cy="30%" r="72%"><stop offset=".48" stopColor="#10275f" stopOpacity="0" /><stop offset=".82" stopColor="#071b58" stopOpacity=".13" /><stop offset="1" stopColor="#02091e" stopOpacity=".52" /></radialGradient>
          <linearGradient id="blueSphereGloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".72" /><stop offset=".45" stopColor="#fff" stopOpacity=".13" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        </defs>
        <g className="blue-bubble-orbits"><circle cx="276" cy="210" r="188" /><circle cx="276" cy="210" r="142" /><path d="M438 112 C500 75 592 78 655 120" /><path d="M445 300 C505 339 592 338 655 294" /></g>
        <g className="blue-data-nodes"><circle cx="418" cy="78" r="3" /><circle cx="456" cy="101" r="2" /><circle cx="490" cy="88" r="1.8" /><circle cx="622" cy="104" r="2.4" /><circle cx="430" cy="326" r="2.5" /><circle cx="481" cy="337" r="1.7" /><circle className="burn" cx="620" cy="309" r="2.4" /><circle className="burn" cx="646" cy="283" r="1.7" /></g>
        <ellipse className="blue-bubble-ground public" cx="276" cy={210 + holderRadius + 10} rx={holderRadius * .58} ry={holderRadius * .075} />
        <ellipse className="blue-bubble-ground creator" cx="548" cy={119 + creatorRadius + 7} rx={creatorRadius * .68} ry={Math.max(3, creatorRadius * .12)} />
        <circle className="blue-bubble public" cx="276" cy="210" r={holderRadius} fill="url(#blueHolderBubble)" />
        <circle className="blue-bubble-depth" cx="276" cy="210" r={holderRadius - 1} fill="url(#blueSphereDepth)" />
        <ellipse className="blue-bubble-gloss" cx={276 - holderRadius * .24} cy={210 - holderRadius * .34} rx={holderRadius * .46} ry={holderRadius * .19} fill="url(#blueSphereGloss)" transform={`rotate(-24 ${276 - holderRadius * .24} ${210 - holderRadius * .34})`} />
        <circle className="blue-bubble-rim" cx="276" cy="210" r={holderRadius - 3} />
        <circle className="blue-bubble creator" cx="548" cy="119" r={creatorRadius} fill="url(#blueCreatorBubble)" />
        <circle className="blue-bubble-depth creator" cx="548" cy="119" r={Math.max(0, creatorRadius - 1)} fill="url(#blueSphereDepth)" />
        <ellipse className="blue-bubble-gloss creator" cx={548 - creatorRadius * .22} cy={119 - creatorRadius * .32} rx={creatorRadius * .42} ry={creatorRadius * .18} fill="url(#blueSphereGloss)" transform={`rotate(-24 ${548 - creatorRadius * .22} ${119 - creatorRadius * .32})`} />
        {burnRadius > 0 ? <g><ellipse className="blue-bubble-ground burn" cx="548" cy={297 + burnRadius + 7} rx={burnRadius * .68} ry={Math.max(3, burnRadius * .12)} /><circle className="blue-bubble burn" cx="548" cy="297" r={burnRadius} fill="url(#blueBurnBubble)" /><circle className="blue-bubble-depth burn" cx="548" cy="297" r={Math.max(0, burnRadius - 1)} fill="url(#blueSphereDepth)" /><ellipse className="blue-bubble-gloss burn" cx={548 - burnRadius * .22} cy={297 - burnRadius * .32} rx={burnRadius * .42} ry={burnRadius * .18} fill="url(#blueSphereGloss)" /></g> : <g className="blue-burn-reactor"><circle cx="548" cy="297" r="21" /><circle cx="548" cy="297" r="13" /><circle cx="548" cy="297" r="5" /></g>}
        <g className="blue-bubble-main-label"><text x="276" y="195" textAnchor="middle">OTHER WALLETS</text><text className="value" x="276" y="242" textAnchor="middle">{holderPercent.toFixed(2)}%</text><text className="amount" x="276" y="267" textAnchor="middle">{quantity(holders?.balance || "0")} BLUE</text></g>
        <g className="blue-bubble-callout creator"><line x1="580" y1="119" x2="650" y2="119" /><text x="664" y="112">CREATOR</text><text className="value" x="664" y="138">{creatorPercent.toFixed(2)}%</text></g>
        <g className="blue-bubble-callout burn"><line x1="570" y1="297" x2="650" y2="297" /><text x="664" y="290">BURNED</text><text className="value" x="664" y="316">{burnPercent.toFixed(2)}%</text></g>
      </svg>
      <p>Bubble area reflects each live onchain balance.</p>
    </div>
    <div className="blue-bubble-summary">
      {allocations.map((item) => <article className={item.id} key={item.id}>
        <div><i /><span>{item.label}</span></div>
        <strong>{item.percent.toFixed(2)}%</strong>
        <footer><span>{quantity(item.balance)} BLUE</span>{item.address ? <AddressLink address={item.address} /> : null}</footer>
      </article>)}
    </div>
  </div>;
}

function AddressLink({ address }: { address: string }) {
  const copy = () => navigator.clipboard.writeText(address);
  return <span className="blue-address"><a href={blueExplorerUrl(address)} target="_blank" rel="noreferrer">{blueAddressLabel(address)} <ExternalLink size={13} /></a><button onClick={copy} aria-label="Copy address"><Copy size={13} /></button></span>;
}

export function BlueTransparencyClient({ initialData }: { initialData: BlueTransparencyData | null }) {
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialData ? null : "Live onchain data is temporarily unavailable.");

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/blue-transparency", { cache: "no-store" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to refresh onchain data.");
      setData(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refresh onchain data.");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!data) return <section className="blue-transparency-error"><ShieldCheck size={22} /><h1>BLUE transparency</h1><p>{error}</p><button className="button primary" onClick={refresh}>Try again</button></section>;

  return <div className="blue-transparency-page">
    <section className="blue-transparency-hero">
      <div className="blue-hero-grid">
        <div className="blue-hero-identity">
          <div className="blue-eyebrow"><i />Blue / Base mainnet</div>
          <div className="blue-identity-main"><div className="blue-token-glyph"><Image src="/brand/bluelogo.webp" alt="BLUE token logo" width={88} height={88} priority /></div><div><p className="blue-token-mark">Official platform token</p><h1>BLUE<span>.</span></h1><p className="blue-lede">An onchain transparency terminal for the FunBlue ecosystem.</p></div></div>
          <div className="blue-identity-meta"><div><span>Network</span><strong>Base</strong></div><div><span>Supply</span><strong>{quantity(data.totalSupply)} BLUE</strong></div><div><span>Launch</span><strong>#{data.launch.id}</strong></div></div>
        </div>
        <div className="blue-live-panel"><span className="blue-live-label"><i />Live on Base</span><strong>Official BLUE</strong><div className="blue-live-rule" /><AddressLink address={data.token} /><div className="blue-hero-actions"><a className="button primary" href={blueExplorerUrl(data.token)} target="_blank" rel="noreferrer">View contract <ExternalLink size={15} /></a><button className="button" onClick={refresh} disabled={isRefreshing} aria-label="Refresh balances">{isRefreshing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}</button></div></div>
      </div>
    </section>

    <BlueStakingPanel />

    <section className="blue-distribution-card">
      <div className="blue-section-heading"><div><span>Live distribution</span><h2>Supply distribution</h2></div><p>Onchain balances</p></div>
      <DistributionChart data={data} />
    </section>

    <section className="blue-proof-grid">
      <article><span className="blue-proof-icon"><CheckCircle2 size={19} /></span><div><span>Token contract</span><strong>Official BLUE on Base</strong><AddressLink address={data.token} /></div></article>
      <article><span className="blue-proof-icon"><LockKeyhole size={19} /></span><div><span>Liquidity route</span><strong>{data.launch.graduated ? "Graduated to Uniswap v4" : "Bonding curve active"}</strong><p>{data.launch.graduated ? `${data.launch.graduationTargetEth} ETH graduation target reached. ${quantity(data.launch.initialLiquidityAllocation)} BLUE was assigned to the locked LP at graduation.` : "Liquidity has not graduated yet."}</p>{data.launch.graduated ? <AddressLink address={data.launch.liquidityLocker} /> : null}</div></article>
      <article><span className="blue-proof-icon"><ShieldCheck size={19} /></span><div><span>Launch creator</span><strong>Disclosed onchain</strong><AddressLink address={data.launch.creator} /></div></article>
    </section>

    {error ? <p className="blue-inline-error">{error}</p> : null}
  </div>;
}
