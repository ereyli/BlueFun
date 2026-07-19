"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Activity, ArrowDownLeft, ArrowUpRight, ExternalLink, Gavel, Images, LayoutDashboard, Loader2, Plus, ShoppingBag, Sparkles, Wallet } from "lucide-react";
import { blueEditionAbi, bluePFPAbi, ipfsGateway } from "@/lib/nft-contracts";
import { NFTWalletOffers } from "./nft-wallet-offers";
import { NFTAssetDialog, type DashboardNFT } from "./nft-asset-dialog";
import { CreatorCollectionManager } from "./creator-collection-manager";

type Collection = { collection: string; name: string; symbol: string; standard: "ERC721" | "ERC1155"; initial_max_supply?: string };
type Owned = DashboardNFT;
type Listing = { listing_id: string; collection: string; token_id: string; remaining_quantity: string; unit_price: string; end_time: string; cancelled: boolean; collectionInfo: Collection | null };
type WalletActivity = { type: "mint" | "received" | "sent"; collection: string; token_id: string; quantity: string; gross_amount?: string; counterparty?: string | null; tx_hash: string; created_at: string };
type DashboardData = { created: Collection[]; owned: Owned[]; listings: Listing[]; activity: WalletActivity[]; indexingReady: boolean; errors?: string[] };

export function NFTDashboard() {
  const { address, isConnected } = useAccount();
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"owned" | "created" | "listings" | "offers" | "activity">("owned");
  const [selectedNFT, setSelectedNFT] = useState<Owned>();
  const [managedCollection, setManagedCollection] = useState<Collection>();
  useEffect(() => {
    if (!address) { setData(undefined); return; }
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/nft/dashboard?wallet=${address}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Dashboard could not be loaded.")))
      .then(setData).catch((error) => { if (error.name !== "AbortError") setData({ created: [], owned: [], listings: [], activity: [], indexingReady: false, errors: [error.message] }); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [address]);

  if (!isConnected) return <div className="nft-dashboard-empty"><section><Wallet/><span>PRIVATE WALLET VIEW</span><h1>Your NFT desk.</h1><p>See collections you created, NFTs you own and every active listing in one place.</p><ConnectButton.Custom>{({ mounted, openConnectModal }) => <button className="button primary" disabled={!mounted} onClick={openConnectModal}><Wallet/>Connect wallet</button>}</ConnectButton.Custom></section></div>;

  const activeListings = data?.listings.filter((listing) => !listing.cancelled && BigInt(listing.remaining_quantity) > 0n && BigInt(listing.end_time) > BigInt(Math.floor(Date.now() / 1000))) || [];
  const listedValue = activeListings.reduce((sum, listing) => sum + BigInt(listing.unit_price) * BigInt(listing.remaining_quantity), 0n);
  return <div className="nft-home nft-dashboard">
    <header className="nft-dashboard-hero"><div><span><LayoutDashboard/>COLLECTOR + CREATOR</span><h1>My NFT desk</h1><p>{shortAddress(address!)} · Base</p></div><Link className="button primary" href="/nft/launch"><Plus/>Create collection</Link></header>
    <section className="nft-dashboard-stats"><article><small>OWNED ITEMS</small><strong>{data?.owned.length ?? "—"}</strong></article><article><small>COLLECTIONS CREATED</small><strong>{data?.created.length ?? "—"}</strong></article><article><small>ACTIVE LISTINGS</small><strong>{activeListings.length}</strong></article><article><small>LISTED VALUE</small><strong>{formatEther(listedValue)} ETH</strong></article></section>
    {loading ? <div className="nft-dashboard-loading"><Loader2 className="spin"/>Syncing onchain ownership…</div> : null}
    {data && !data.indexingReady ? <p className="nft-dashboard-warning">Ownership indexing is not enabled yet. Created collections and listings remain available.</p> : null}
    <nav className="nft-dashboard-tabs" aria-label="Wallet views"><button className={tab === "owned" ? "active" : ""} onClick={() => setTab("owned")}><Images/>Collected <b>{data?.owned.length || 0}</b></button><button className={tab === "created" ? "active" : ""} onClick={() => setTab("created")}><Sparkles/>Created <b>{data?.created.length || 0}</b></button><button className={tab === "listings" ? "active" : ""} onClick={() => setTab("listings")}><ShoppingBag/>Listings <b>{activeListings.length}</b></button><button className={tab === "offers" ? "active" : ""} onClick={() => setTab("offers")}><Gavel/>Offers</button><button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><Activity/>Activity</button></nav>
    {tab === "owned" ? <DashboardSection icon={<Images/>} title="Collected NFTs" count={data?.owned.length || 0} empty="NFTs held by this wallet will appear here." grid>
      {data?.owned.map((item) => <OwnedNFTCard item={item} key={`${item.collection}-${item.token_id}`} onOpen={() => setSelectedNFT(item)}/>)}
    </DashboardSection> : null}
    {tab === "created" ? <DashboardSection icon={<Sparkles/>} title="Created collections" count={data?.created.length || 0} empty="Collections launched by this wallet will appear here.">
      {data?.created.map((item) => <button className="nft-dashboard-row" onClick={()=>setManagedCollection(item)} key={item.collection}><span className="nft-dashboard-thumb"><Images/></span><span><strong>{item.name}</strong><small>{item.standard === "ERC721" ? "Generative PFP · ERC-721" : "Editions · ERC-1155"} · {item.symbol}</small></span><em>Manage</em></button>)}
    </DashboardSection> : null}
    {tab==="created"&&managedCollection?<CreatorCollectionManager item={managedCollection} onClose={()=>setManagedCollection(undefined)}/>:null}
    {tab === "listings" ? <DashboardSection icon={<ShoppingBag/>} title="My listings" count={data?.listings.length || 0} empty="NFTs listed from this wallet will appear here.">
      {data?.listings.map((item) => { const active = !item.cancelled && BigInt(item.remaining_quantity) > 0n && BigInt(item.end_time) > BigInt(Math.floor(Date.now() / 1000)); return <Link className="nft-dashboard-row" href={`/nft/${item.collection}/${item.token_id}`} key={item.listing_id}><span className="nft-dashboard-thumb"><ShoppingBag/></span><span><strong>{item.collectionInfo?.name || shortAddress(item.collection)} #{item.token_id}</strong><small>{formatEther(BigInt(item.unit_price))} ETH · {active ? "Active" : item.cancelled ? "Cancelled" : "Ended"}</small></span><em className={active ? "live" : ""}>{active ? "Live" : "Closed"}</em></Link>; })}
    </DashboardSection> : null}
    {tab === "offers" ? <NFTWalletOffers/> : null}
    {tab === "activity" ? <DashboardSection icon={<Activity/>} title="Wallet activity" count={data?.activity.length || 0} empty="Confirmed NFT mints and transfers will appear here.">
      {data?.activity.map((item, index) => <a className="nft-dashboard-row" href={`https://basescan.org/tx/${item.tx_hash}`} target="_blank" rel="noreferrer" key={`${item.tx_hash}-${index}`}><span className="nft-dashboard-thumb">{item.type === "sent" ? <ArrowUpRight/> : <ArrowDownLeft/>}</span><span><strong>{item.type === "mint" ? "Minted" : item.type === "received" ? "Received" : "Sent"} token #{item.token_id}</strong><small>{item.quantity} item{item.quantity === "1" ? "" : "s"}{item.counterparty ? ` · ${shortAddress(item.counterparty)}` : ""}</small></span><ExternalLink/></a>)}
    </DashboardSection> : null}
    {selectedNFT ? <NFTAssetDialog item={selectedNFT} onClose={() => setSelectedNFT(undefined)}/> : null}
  </div>;
}

function DashboardSection({ icon, title, count, empty, children, grid = false }: { icon: React.ReactNode; title: string; count: number; empty: string; children: React.ReactNode; grid?: boolean }) {
  return <section className="nft-directory-panel nft-dashboard-panel"><header><div><span>{icon} WALLET INDEX</span><h2>{title}</h2></div><strong>{count}</strong></header><div className={`nft-dashboard-list ${grid ? "nft-owned-grid" : ""}`}>{count ? children : <p>{empty}</p>}</div></section>;
}

function OwnedNFTCard({ item, onOpen }: { item: Owned; onOpen: () => void }) {
  const [metadata, setMetadata] = useState<{ name?: string; image?: string }>({});
  const collection = item.collection as Address; const tokenId = BigInt(item.token_id); const isPFP = item.collectionInfo?.standard === "ERC721";
  const pfpUri = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "tokenURI", args: [tokenId], chainId: 8453, query: { enabled: isPFP } });
  const editionUri = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "uri", args: [tokenId], chainId: 8453, query: { enabled: !isPFP } });
  const metadataUri = pfpUri.data || editionUri.data || item.metadataUri;
  useEffect(() => { if (!metadataUri) return; fetch(ipfsGateway(metadataUri)).then((response) => response.ok ? response.json() : {}).then(setMetadata).catch(() => undefined); }, [metadataUri]);
  return <button className="nft-owned-card" onClick={onOpen}><span className="nft-owned-art">{metadata.image ? <img src={ipfsGateway(metadata.image)} alt={metadata.name || "NFT"}/> : <Sparkles/>}<i>{item.collectionInfo?.standard === "ERC721" ? "ERC-721" : `${item.balance} owned`}</i></span><span className="nft-owned-card-body"><small>{item.collectionInfo?.name || shortAddress(item.collection)}</small><strong>{metadata.name || `Token #${item.token_id}`}</strong><span><b>View details</b><ExternalLink/></span></span></button>;
}
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
