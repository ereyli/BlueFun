"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { Activity, ArrowDownLeft, ArrowUpRight, ChevronRight, ExternalLink, Gavel, Images, LayoutDashboard, Loader2, Plus, ShoppingBag, Sparkles, Trash2, Wallet } from "lucide-react";
import { blueEditionAbi, bluePFPAbi, nftMarketplaceAbi, nftPFPMarketplaceAbi } from "@/lib/nft-contracts";
import { NFTWalletOffers } from "./nft-wallet-offers";
import { NFTAssetDialog, type DashboardNFT } from "./nft-asset-dialog";
import { CreatorCollectionManager } from "./creator-collection-manager";
import { nftMetadataUrl, optimizedTokenImageUrl } from "@/lib/token-metadata";

type Collection = { collection: string; factory?: string; name: string; symbol: string; standard: "ERC721" | "ERC1155"; initial_max_supply?: string; created_at?: string };
type Owned = DashboardNFT;
type Listing = { marketplace: Address; listing_id: string; collection: string; token_id: string; remaining_quantity: string; unit_price: string; start_time: string; end_time: string; cancelled: boolean; standard: "ERC721" | "ERC1155"; onchainActive?: boolean; collectionInfo: Collection | null };
type WalletActivity = { type: "mint" | "received" | "sent"; collection: string; token_id: string; quantity: string; gross_amount?: string; counterparty?: string | null; tx_hash: string; created_at: string };
type DashboardData = { created: Collection[]; owned: Owned[]; listings: Listing[]; activity: WalletActivity[]; indexingReady: boolean; errors?: string[] };

export function NFTDashboard() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 8453 });
  const { writeContractAsync, isPending: listingPending } = useWriteContract();
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"owned" | "created" | "listings" | "offers" | "activity">("created");
  const [selectedNFT, setSelectedNFT] = useState<Owned>();
  const [managedCollection, setManagedCollection] = useState<Collection>();
  const [contractInput, setContractInput] = useState("");
  const [contractNotice, setContractNotice] = useState("");
  const [listingNotice, setListingNotice] = useState("");
  const [confirmListing, setConfirmListing] = useState("");
  useEffect(() => {
    if (!address) { setData(undefined); return; }
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/nft/dashboard?wallet=${address}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Dashboard could not be loaded.")))
      .then(setData).catch((error) => { if (error.name !== "AbortError") setData({ created: [], owned: [], listings: [], activity: [], indexingReady: false, errors: [error.message] }); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [address]);

  async function openCollectionContract() {
    setContractNotice("");
    try {
      const response = await fetch(`/api/nft/collection?address=${encodeURIComponent(contractInput)}`);
      const result = await response.json() as { collection?: Collection; error?: string };
      if (!response.ok || !result.collection) throw new Error(result.error || "Collection could not be loaded.");
      setManagedCollection(result.collection); setTab("created");
    } catch (error) { setContractNotice(error instanceof Error ? error.message : "Collection could not be loaded."); }
  }

  async function cancelListing(item: Listing) {
    const key = `${item.marketplace}:${item.listing_id}`;
    if (confirmListing !== key) { setConfirmListing(key); return; }
    setListingNotice("");
    try {
      const indexedId = BigInt(item.listing_id);
      const listingId = indexedId < 0n ? -indexedId : indexedId;
      const hash = item.standard === "ERC721"
        ? await writeContractAsync({ chainId: 8453, address: item.marketplace, abi: nftPFPMarketplaceAbi, functionName: "cancelListing", args: [listingId] })
        : await writeContractAsync({ chainId: 8453, address: item.marketplace, abi: nftMarketplaceAbi, functionName: "cancelListing", args: [listingId] });
      setListingNotice("Cancellation submitted. Waiting for Base confirmation…");
      await publicClient?.waitForTransactionReceipt({ hash });
      setData((current) => current ? { ...current, listings: current.listings.map((listing) => listing === item ? { ...listing, cancelled: true, onchainActive: false } : listing) } : current);
      setListingNotice("Listing cancelled successfully.");
      setConfirmListing("");
    } catch (error) {
      setListingNotice(shortError(error, "Listing cancellation failed."));
    }
  }

  if (!isConnected) return <div className="nft-dashboard-empty"><section><Wallet/><span>PRIVATE WALLET VIEW</span><h1>Your NFT desk.</h1><p>See collections you created, NFTs you own and every active listing in one place.</p><ConnectButton.Custom>{({ mounted, openConnectModal }) => <button className="button primary" disabled={!mounted} onClick={openConnectModal}><Wallet/>Connect wallet</button>}</ConnectButton.Custom></section></div>;

  const activeListings = data?.listings.filter((listing) => listing.onchainActive ?? (!listing.cancelled && BigInt(listing.remaining_quantity) > 0n && BigInt(listing.end_time) > BigInt(Math.floor(Date.now() / 1000)))) || [];
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
    {tab === "created" && !managedCollection ? <section className="nft-directory-panel nft-dashboard-panel nft-created-panel">
      <header><div><span><Sparkles/>CREATOR PORTFOLIO</span><h2>Your collections</h2><p>Select a collection to manage minting, earnings, metadata and reveal.</p></div><strong>{data?.created.length || 0}</strong></header>
      {data?.created.length ? <div className="nft-created-grid">{data.created.map((item) => <CreatorCollectionCard item={item} key={item.collection} onOpen={() => setManagedCollection(item)}/>)}</div> : <div className="nft-created-empty"><Images/><h3>No collections yet</h3><p>Collections launched from this wallet will appear here.</p><Link className="button primary" href="/nft/launch"><Plus/>Create collection</Link></div>}
    </section> : null}
    {tab === "created" && !managedCollection ? <details className="nft-dashboard-import"><summary>Manage a transferred collection</summary><div><small>Enter the collection contract after an ownership transfer or nomination.</small></div><input aria-label="Collection contract address" placeholder="0x collection address" value={contractInput} onChange={(event) => setContractInput(event.target.value)}/><button className="button" onClick={() => void openCollectionContract()}>Open collection</button>{contractNotice ? <p>{contractNotice}</p> : null}</details> : null}
    {tab==="created"&&managedCollection?<CreatorCollectionManager item={managedCollection} onClose={()=>setManagedCollection(undefined)}/>:null}
    {tab === "listings" ? <DashboardSection icon={<ShoppingBag/>} title="My listings" count={data?.listings.length || 0} empty="NFTs listed from this wallet will appear here.">
      {data?.listings.map((item) => { const active = item.onchainActive ?? false; const key = `${item.marketplace}:${item.listing_id}`; return <div className="nft-dashboard-row nft-listing-row" key={key}><span className="nft-dashboard-thumb"><ShoppingBag/></span><span><strong>{item.collectionInfo?.name || shortAddress(item.collection)} #{item.token_id}</strong><small>{formatEther(BigInt(item.unit_price))} ETH · {active ? "Active on Base" : item.cancelled ? "Cancelled" : "Sold or ended"}</small></span><div className="nft-dashboard-row-actions"><em className={active ? "live" : ""}>{active ? "Live" : "Closed"}</em><Link className="button" href={`/nft/${item.collection}/${item.token_id}`}>View</Link>{active ? <button className={`button ${confirmListing === key ? "danger" : ""}`} disabled={listingPending} onClick={() => void cancelListing(item)}>{listingPending && confirmListing === key ? <Loader2 className="spin"/> : <Trash2/>}{confirmListing === key ? "Confirm cancel" : "Cancel"}</button> : null}</div></div>; })}
      {listingNotice ? <p className="nft-status">{listingNotice}</p> : null}
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
  const pfpRevealed = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "revealed", chainId: 8453, query: { enabled: isPFP } });
  const pfpBaseURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "baseURI", chainId: 8453, query: { enabled: isPFP && pfpRevealed.data === true } });
  const pfpPlaceholderURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "placeholderURI", chainId: 8453, query: { enabled: isPFP && pfpRevealed.data === false } });
  const editionUri = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "uri", args: [tokenId], chainId: 8453, query: { enabled: !isPFP } });
  const metadataUri = isPFP
    ? pfpRevealed.data === true ? `${pfpBaseURI.data || ""}${tokenId}` : pfpRevealed.data === false ? pfpPlaceholderURI.data || "" : ""
    : editionUri.data || item.metadataUri;
  useEffect(() => { if (!metadataUri) return; fetch(nftMetadataUrl(metadataUri)).then((response) => response.ok ? response.json() : {}).then(setMetadata).catch(() => undefined); }, [metadataUri]);
  return <button className="nft-owned-card" onClick={onOpen}><span className="nft-owned-art">{metadata.image ? <img src={optimizedTokenImageUrl(metadata.image)} alt={metadata.name || "NFT"}/> : <Sparkles/>}<i>{item.collectionInfo?.standard === "ERC721" ? "ERC-721" : `${item.balance} owned`}</i></span><span className="nft-owned-card-body"><small>{item.collectionInfo?.name || shortAddress(item.collection)}</small><strong>{metadata.name || `Token #${item.token_id}`}</strong><span><b>View details</b><ExternalLink/></span></span></button>;
}

function CreatorCollectionCard({ item, onOpen }: { item: Collection; onOpen: () => void }) {
  const collection = item.collection as Address;
  const contractURI = useReadContract({ address: collection, abi: item.standard === "ERC721" ? bluePFPAbi : blueEditionAbi, functionName: "contractURI", chainId: 8453 });
  const [metadata, setMetadata] = useState<{ image?: string }>({});
  useEffect(() => {
    if (!contractURI.data) return;
    fetch(nftMetadataUrl(String(contractURI.data))).then((response) => response.ok ? response.json() : {}).then(setMetadata).catch(() => undefined);
  }, [contractURI.data]);
  return <button className="nft-created-card" onClick={onOpen}>
    <span className={`nft-created-art ${item.standard === "ERC721" ? "pfp" : "edition"}`}>
      {metadata.image ? <img src={optimizedTokenImageUrl(metadata.image)} alt=""/> : item.standard === "ERC721" ? <Sparkles/> : <Images/>}
      <i><span/>Live on Base</i>
      <em>{item.standard === "ERC721" ? "ERC-721 PFP" : "ERC-1155 EDITION"}</em>
    </span>
    <span className="nft-created-card-body">
      <small>{item.symbol}</small>
      <strong>{item.name}</strong>
      <span><code>{shortAddress(item.collection)}</code><b>Open dashboard <ChevronRight/></b></span>
    </span>
  </button>;
}
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function shortError(error: unknown, fallback: string) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 220) : fallback; }
