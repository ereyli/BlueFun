"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, ExternalLink, Globe2, Layers3, Radio, Send, Share2, ShieldCheck } from "lucide-react";
import { formatEther } from "viem";
import { NFTCollectionShareDialog } from "./nft-collection-share-dialog";

type MarketSummary = { floorPrice: string | null; totalVolume: string; sales: number; mints: number; listed: number; owners: number };
type Offer = { priceWeth?: string };

export function NFTCollectionProfile({
  collection, name, symbol, description, image, creator, standard, supply, minted, royaltyBps, status, socials, mintPanel
}: {
  collection: string; name: string; symbol: string; description: string; image?: string; creator?: string;
  standard: "ERC-721" | "ERC-1155"; supply: bigint; minted: bigint; royaltyBps: bigint; status: string;
  socials?: { website?: string; x?: string; twitter?: string; telegram?: string }; mintPanel?: ReactNode;
}) {
  const [summary, setSummary] = useState<MarketSummary>({ floorPrice: null, totalVolume: "0", sales: 0, mints: 0, listed: 0, owners: 0 });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/nft/activity?collection=${collection}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined),
      fetch(`/api/nft/offers?collection=${collection}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined)
    ]).then(([activity, offerPayload]) => {
      if (activity?.summary) setSummary(activity.summary);
      setOffers(Array.isArray(offerPayload?.offers) ? offerPayload.offers : []);
    }).catch(() => undefined);
  }, [collection]);

  const topOffer = useMemo(() => offers.reduce<number | null>((top, offer) => {
    const price = Number(offer.priceWeth);
    return Number.isFinite(price) && price > 0 && (top === null || price > top) ? price : top;
  }, null), [offers]);
  const floor = summary.floorPrice ? formatWei(summary.floorPrice) : "—";
  const volume = formatWei(summary.totalVolume);
  const royalty = `${(Number(royaltyBps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const shortCreator = creator ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : "Loading…";
  const website = safeSocialUrl(socials?.website);
  const x = safeSocialUrl(socials?.x || socials?.twitter, ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
  const telegram = safeSocialUrl(socials?.telegram, ["t.me", "telegram.me", "www.telegram.me"]);

  return <section className={`nft-profile-shell ${mintPanel ? "has-mint" : "mint-hidden"}`}>
    <div className="nft-profile-banner">
      {image ? <img src={image} alt="" aria-hidden="true"/> : null}
      <div className="nft-profile-banner-shade"/>
      <button className="nft-profile-share" aria-label="Share collection" onClick={() => setShareOpen(true)}><Share2/>Share</button>
      <div className="nft-profile-overview">
        <div className="nft-profile-identity">
          <div className="nft-profile-avatar">{image ? <img src={image} alt={`${name} collection`}/> : <Layers3/>}</div>
          <div className="nft-profile-title"><span>{standard} · BASE</span><h1>{name}</h1><div><b>By {shortCreator}</b><BadgeCheck/><em>{symbol}</em></div></div>
        </div>
        <div className="nft-profile-about">
          <div className="nft-profile-chips"><span><Radio/>{status}</span><span>Base</span><span>{supply.toLocaleString("en-US")} items</span><span>{minted.toLocaleString("en-US")} minted</span><span>{royalty} royalty</span></div>
          <p>{description}</p>
          <div className="nft-profile-links"><a href={`https://basescan.org/address/${collection}`} target="_blank" rel="noreferrer"><ShieldCheck/>Verified contract <ExternalLink/></a><a href={`https://opensea.io/assets/base/${collection}`} target="_blank" rel="noreferrer">OpenSea <ExternalLink/></a>{website?<a href={website} target="_blank" rel="noreferrer"><Globe2/>Website</a>:null}{x?<a href={x} target="_blank" rel="noreferrer"><b>𝕏</b>X</a>:null}{telegram?<a href={telegram} target="_blank" rel="noreferrer"><Send/>Telegram</a>:null}<code>{collection.slice(0, 8)}…{collection.slice(-6)}</code></div>
        </div>
      </div>
      {mintPanel ? <div className="nft-profile-mint">{mintPanel}</div> : null}
    </div>
    <div className="nft-profile-marketbar" aria-label="Collection market summary">
      <div className="nft-profile-marketbar-title"><small>MARKET OVERVIEW</small><strong>Live collection data</strong></div>
      <div className="nft-profile-stats">
        <ProfileStat label="FLOOR PRICE" value={floor === "—" ? floor : `${floor} ETH`}/>
        <ProfileStat label="TOP OFFER" value={topOffer === null ? "—" : `${formatNumber(topOffer)} WETH`}/>
        <ProfileStat label="TOTAL VOLUME" value={`${volume} ETH`}/>
        <ProfileStat label="LISTED" value={String(summary.listed)}/>
      </div>
    </div>
    <NFTCollectionShareDialog collection={collection} name={name} symbol={symbol} status={status} minted={minted} supply={supply} floor={floor === "—" ? floor : `${floor} ETH`} volume={`${volume} ETH`} owners={summary.owners} open={shareOpen} onClose={() => setShareOpen(false)}/>
  </section>;
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function formatWei(value: string) {
  try { return formatNumber(Number(formatEther(BigInt(value)))); } catch { return "0"; }
}
function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
function safeSocialUrl(value?: string, allowedHosts?: string[]) {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && (!allowedHosts || allowedHosts.includes(url.hostname.toLowerCase())) ? url.toString() : undefined; } catch { return undefined; }
}
