"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, parseEther } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ChevronLeft, ChevronRight, ExternalLink, Eye, Grid2X2, List as ListIcon, Loader2, Search, ShieldCheck, ShoppingBag, Sparkles } from "lucide-react";
import { bluePFPAbi, nftAddresses, nftControllerForDeployment, nftDropControllerAbi, nftFeePolicyAbi, nftMarketplaceForDeployment, nftPFPMarketplaceAbi, pfpLaunchpadEnabled, type NFTDeployment } from "@/lib/nft-contracts";
import { NFTCollectionTabs } from "../../nft-collection-tabs";
import { NFTCollectionProfile } from "../../nft-collection-profile";
import { NFTCommerceDialog } from "../../nft-commerce-dialog";
import { NFTOffersPanel } from "../../nft-offers-panel";
import { MintPhaseStatus } from "@/components/nft-mint-schedule";
import { useNFTMintPhase } from "@/lib/use-nft-mint-phase";
import { useNFTAllowlistProof } from "@/lib/use-nft-allowlist-proof";
import { nftMetadataUrl, optimizedTokenImageUrl } from "@/lib/token-metadata";
import { NFTQuickBuyDialog, type NFTQuickBuyItem } from "../../nft-quick-buy-dialog";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";

export function PFPMintMarket({ collection, tokenId, view = "item", deployment = "current" }: { collection: `0x${string}`; tokenId: bigint; view?: "item" | "collection"; deployment?: NFTDeployment }) {
  const { address, isConnected } = useAccount(); const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: 8453 });
  const [quantity, setQuantity] = useState("1"); const [metadata, setMetadata] = useState<{ name?: string; description?: string; image?: string; attributes?: Array<{ trait_type?: string; value?: string | number }> }>({});
  const [collectionMetadata, setCollectionMetadata] = useState<CollectionMetadata>({});
  const controllerAddress = nftControllerForDeployment(deployment);
  const marketAddress = nftMarketplaceForDeployment(deployment, "ERC721");
  const [notice, setNotice] = useState(""); const [listingId, setListingId] = useState(""); const [listingMarketplace,setListingMarketplace]=useState<`0x${string}`>(marketAddress); const [salePrice, setSalePrice] = useState("0.1");
  const [commerceDialog, setCommerceDialog] = useState<"buy" | "list" | null>(null); const [listingDays, setListingDays] = useState("30");
  const [revealURI, setRevealURI] = useState(""); const [freezeReveal, setFreezeReveal] = useState(true);
  const name = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "name", chainId: 8453 });
  const symbol = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "symbol", chainId: 8453 });
  const owner = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "owner", chainId: 8453 });
  const baseURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "baseURI", chainId: 8453 });
  const placeholderURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "placeholderURI", chainId: 8453 });
  const contractURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "contractURI", chainId: 8453 });
  const max = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "collectionMaxSupply", chainId: 8453 });
  const minted = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "totalLifetimeMinted", chainId: 8453 });
  const revealed = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "revealed", chainId: 8453 });
  const metadataFrozen = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "metadataFrozen", chainId: 8453 });
  const royaltyBps = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "royaltyBps", chainId: 8453 });
  const marketplaceFeeBps = useReadContract({ address: nftAddresses.feePolicy, abi: nftFeePolicyAbi, functionName: "marketplaceFeeBps", chainId: 8453, query: { enabled: pfpLaunchpadEnabled } });
  const { phaseId, phaseData, nowSeconds, isLoading: phaseLoading } = useNFTMintPhase(collection, 1n, controllerAddress, pfpLaunchpadEnabled);
  const phaseType = Number(phaseData?.[0] ?? 0); const allowlistProof = useNFTAllowlistProof(collection, 1n, phaseId, address, phaseType === 1);
  const mintedInPhase = useReadContract({ address: controllerAddress, abi: nftDropControllerAbi, functionName: "phaseMinted", args: [collection, 1n, phaseId], chainId: 8453, query: { enabled: pfpLaunchpadEnabled && phaseId > 0n } });
  const walletMintedInPhase = useReadContract({ address: controllerAddress, abi: nftDropControllerAbi, functionName: "mintedByWalletInPhase", args: [collection, 1n, phaseId, address!], chainId: 8453, query: { enabled: pfpLaunchpadEnabled && phaseId > 0n && Boolean(address) } });
  const walletMintedTotal = useReadContract({ address: controllerAddress, abi: nftDropControllerAbi, functionName: "mintedByWalletTotal", args: [collection, 1n, address!], chainId: 8453, query: { enabled: pfpLaunchpadEnabled && Boolean(address) } });
  const tokenOwner = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "ownerOf", args: [tokenId], chainId: 8453, query: { enabled: tokenId <= (minted.data ?? 0n) } });
  const approval = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "getApproved", args: [tokenId], chainId: 8453, query: { enabled: Boolean(tokenOwner.data) } });
  const parsedListingId = safePositiveBigInt(listingId) ?? 0n;
  const listing = useReadContract({ address: listingMarketplace, abi: nftPFPMarketplaceAbi, functionName: "listings", args: [parsedListingId], chainId: 8453, query: { enabled: pfpLaunchpadEnabled && parsedListingId > 0n } });
  const unitPrice = phaseType === 0 ? phaseData?.[3] ?? 0n : allowlistProof.entry?.unitPrice ?? 0n;
  const phaseActive = Boolean(phaseData && !phaseData[11] && nowSeconds >= phaseData[4] && nowSeconds < phaseData[5]);
  const maxPerTransaction = BigInt(phaseData?.[8] ?? 0);
  const collectionRemaining = max.data && minted.data !== undefined ? max.data > minted.data ? max.data - minted.data : 0n : 0n;
  const phaseRemaining = phaseData ? remaining(phaseData[6], mintedInPhase.data ?? 0n) : 0n;
  const walletUsed = phaseData?.[1] === 0 ? walletMintedInPhase.data ?? 0n : walletMintedTotal.data ?? 0n;
  const walletCap = phaseType === 0 ? BigInt(phaseData?.[7] ?? 0) : allowlistProof.entry?.allowance ?? 0n;
  const walletRemaining = phaseData ? remaining(walletCap, walletUsed) : 0n;
  const mintLimit = minPositive(maxPerTransaction, collectionRemaining, phaseRemaining, walletRemaining);
  const mintAmount = safePositiveBigInt(quantity);
  const allowlistReady = phaseType === 0 || Boolean(allowlistProof.entry);
  const canMint = Boolean(isConnected && address && phaseData && phaseActive && mintAmount && mintLimit > 0n && mintAmount <= mintLimit && allowlistReady && !isPending);
  const mintFinished = Boolean(phaseData && (phaseData[11] || nowSeconds >= phaseData[5] || collectionRemaining === 0n || phaseRemaining === 0n));
  const mintAvailability = !phaseData ? phaseLoading ? "Loading mint configuration…" : "No mint phase is configured." : phaseData[11] ? "This mint phase was cancelled." : nowSeconds < phaseData[4] ? "Mint has not opened yet." : nowSeconds >= phaseData[5] ? "This mint phase has ended." : mintLimit === 0n ? "No mint allowance remains for this wallet or collection." : mintAmount && mintAmount > mintLimit ? `Maximum available in this transaction: ${mintLimit}.` : !isConnected ? "Connect your wallet to mint." : "NFT token IDs are assigned automatically when the transaction confirms.";
  const listingMatches = Boolean(listing.data && listing.data[1].toLowerCase() === collection.toLowerCase() && listing.data[2] === tokenId && !listing.data[6] && !listing.data[7] && listing.data[4] <= nowSeconds && listing.data[5] > nowSeconds);
  const isListingSeller = Boolean(address && listing.data?.[0].toLowerCase() === address.toLowerCase());
  const isCreator = Boolean(address && owner.data?.toLowerCase() === address.toLowerCase());
  const ownsToken = Boolean(address && tokenOwner.data?.toLowerCase() === address.toLowerCase());

  const resolvedTokenURI = revealed.data ? `${baseURI.data || ""}${tokenId}` : placeholderURI.data || "";
  useEffect(() => { if (!resolvedTokenURI) return; fetch(nftMetadataUrl(resolvedTokenURI)).then((response) => response.ok ? response.json() : {}).then(setMetadata).catch(() => undefined); }, [resolvedTokenURI]);
  useEffect(() => { if (!contractURI.data) return; fetch(nftMetadataUrl(contractURI.data)).then((response) => response.ok ? response.json() : {}).then(setCollectionMetadata).catch(() => undefined); }, [contractURI.data]);
  useEffect(() => { fetch(`/api/nft/listing?collection=${collection}&tokenId=${tokenId}`).then((response) => response.ok ? response.json() : {}).then((data: { listingId?: string;marketplace?:`0x${string}` }) => {setListingId(data.listingId||"");if(data.marketplace)setListingMarketplace(data.marketplace);}).catch(() => undefined); }, [collection, tokenId]);

  async function mint() {
    if (!address || !phaseData) return; setNotice(""); const amount = safePositiveBigInt(quantity); const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    try {
      if (!amount) throw new Error("Enter a valid mint quantity.");
      if (!phaseActive) throw new Error("The current mint phase is not active.");
      if (amount > mintLimit) throw new Error(`You can mint at most ${mintLimit} in this transaction.`);
      const hash = phaseType === 0
        ? await writeContractAsync({ chainId: 8453, address: controllerAddress, abi: nftDropControllerAbi, functionName: "mintPublic", value: unitPrice * amount, args: [collection, 1n, phaseId, amount, address, unitPrice, deadline] })
        : allowlistProof.entry
          ? await writeContractAsync({ chainId: 8453, address: controllerAddress,abi:nftDropControllerAbi,functionName:"mintAllowlist",value:unitPrice*amount,args:[collection,1n,phaseId,amount,address,allowlistProof.entry.allowance,unitPrice,deadline,allowlistProof.entry.proof] })
          : (() => { throw new Error("This wallet is not eligible for the allowlist phase."); })();
      setNotice("Mint submitted. Waiting for Base confirmation…"); await publicClient?.waitForTransactionReceipt({ hash });
      setNotice("Mint confirmed. Your collection is updating."); void minted.refetch(); void walletMintedInPhase.refetch(); void walletMintedTotal.refetch();
    } catch (error) { setNotice(shortError(error)); }
  }

  async function approveOrList() {
    try {
      if (approval.data?.toLowerCase() !== marketAddress.toLowerCase()) {
        const approvalHash = await writeContractAsync({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "approve", args: [marketAddress, tokenId] });
        setNotice("Approval submitted. Waiting for confirmation…"); await publicClient?.waitForTransactionReceipt({ hash: approvalHash }); await approval.refetch();
      }
      const now = BigInt(Math.floor(Date.now() / 1000)); const duration = BigInt(Number(listingDays) || 30) * 86400n;
      const listingHash = await writeContractAsync({ chainId: 8453, address: marketAddress, abi: nftPFPMarketplaceAbi, functionName: "createListing", args: [collection, tokenId, parseEther(salePrice), now, now + duration] });
      setNotice("Listing submitted. Waiting for confirmation…"); await publicClient?.waitForTransactionReceipt({ hash: listingHash });
      setNotice("Listing is live."); setCommerceDialog(null);
    } catch (error) { setNotice(shortError(error)); }
  }

  async function buy() { if (!address || !listing.data || !listingMatches) return; try { const hash = await writeContractAsync({ chainId: 8453, address: listingMarketplace, abi: nftPFPMarketplaceAbi, functionName: "buy", value: listing.data[3], args: [parsedListingId, address] }); setNotice("Purchase submitted. Waiting for confirmation…"); await publicClient?.waitForTransactionReceipt({ hash }); setNotice("Purchase confirmed."); setCommerceDialog(null); void listing.refetch(); void tokenOwner.refetch(); } catch (error) { setNotice(shortError(error)); } }
  async function cancelSale() { if (!parsedListingId) return; try { const hash = await writeContractAsync({ chainId: 8453, address: listingMarketplace, abi: nftPFPMarketplaceAbi, functionName: "cancelListing", args: [parsedListingId] }); setNotice("Cancellation submitted. Waiting for confirmation…"); await publicClient?.waitForTransactionReceipt({ hash }); setNotice("Listing cancelled."); void listing.refetch(); } catch (error) { setNotice(shortError(error)); } }
  async function reveal() { try { await writeContractAsync({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "reveal", args: [revealURI, freezeReveal] }); setNotice("Reveal transaction submitted. Marketplaces may need a metadata refresh."); } catch (error) { setNotice(shortError(error)); } }
  async function updateMetadata() { try { await writeContractAsync({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "setBaseURI", args: [revealURI] }); setNotice("Metadata update submitted. Use OpenSea refresh after confirmation."); } catch (error) { setNotice(shortError(error)); } }
  async function freezeMetadataForever() { try { await writeContractAsync({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "freezeMetadata" }); setNotice("Permanent metadata freeze submitted."); } catch (error) { setNotice(shortError(error)); } }

  const mintedCount = minted.data ?? 0n; const maxSupply = max.data ?? 0n;
  const mintTotal = unitPrice * (mintAmount ?? 0n);
  const primaryMintPanel = <section className="nft-compact-mint"><header><div><span>PRIMARY MINT</span><h2>Mint your PFP</h2></div><strong>{unitPrice === 0n ? "FREE" : `${formatEther(unitPrice)} ETH`}</strong></header>{phaseId === 0n || !phaseData ? <p className="nft-compact-empty">{phaseLoading ? "Loading mint phase…" : "No mint phase is configured."}</p> : <><MintPhaseStatus phaseType={phaseType} start={phaseData[4]} end={phaseData[5]} now={nowSeconds}/>{phaseType===1?<p className="nft-compact-note">{allowlistProof.loading?"Checking wallet eligibility…":allowlistProof.entry?`Eligible · allowance ${allowlistProof.entry.allowance}`:"This wallet is not on the active allowlist."}</p>:null}<div className="nft-compact-mint-row"><div className="field"><label>Quantity <small>Max {mintLimit > 0n ? String(mintLimit) : "—"}</small></label><input min="1" max={mintLimit > 0n ? mintLimit.toString() : "1"} type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)}/></div><div className="nft-mint-total"><small>TOTAL</small><strong>{mintTotal === 0n ? "Free" : `${formatEther(mintTotal)} ETH`}</strong></div></div><button className="button primary nft-mint-button" disabled={!canMint} onClick={() => void mint()}>{isPending ? <Loader2 className="spin"/> : <ShoppingBag/>}Mint {mintAmount ? String(mintAmount) : ""}</button><p className="nft-compact-note"><ShieldCheck/>{mintAvailability}</p></>}</section>;

  if (view === "collection") return <div className={`nft-home nft-drop-home ${mintFinished ? "mint-complete" : ""}`}>
    <NFTCollectionProfile collection={collection} name={name.data || "PFP collection"} symbol={symbol.data || "PFP"} description={collectionMetadata.description || metadata.description || (mintFinished ? "Primary mint is complete. Explore and trade the collection." : "Randomly assigned artwork with unique token IDs.")} image={optimizedTokenImageUrl(collectionMetadata.image || metadata.image)} creator={owner.data} standard="ERC-721" supply={maxSupply} minted={mintedCount} royaltyBps={BigInt(royaltyBps.data ?? 0)} status={mintFinished ? "Mint complete" : revealed.data ? "Live · Revealed" : "Live · Unrevealed"} socials={socialsFromMetadata(collectionMetadata)} mintPanel={mintFinished ? null : primaryMintPanel}/>
    <NFTCollectionTabs collection={collection} offers={<NFTOffersPanel collection={collection} standard="ERC721" mode="collection"/>}><PFPTokenGrid collection={collection} count={Number(minted.data ?? 0n)}/></NFTCollectionTabs>
    {notice ? <p className="nft-status">{notice}</p> : null}
  </div>;

  return <div className="pfp-detail-page">
    <div className="nft-item-page pfp-item-page"><section className="card nft-item-art">{metadata.image ? <img src={optimizedTokenImageUrl(metadata.image)} alt={metadata.name || "PFP"}/> : <div><Sparkles/></div>}</section>
      <section className="nft-item-content"><span className="eyebrow">{name.data || "BlueFun PFP"} · {symbol.data || "PFP"} · ERC-721</span><h1>{metadata.name || `Token #${tokenId}`}</h1><p>{metadata.description || (revealed.data ? "Metadata loading…" : "This collection is waiting for its reveal.")}</p><div className="pfp-item-links"><Link href={`/nft/${collection}`}>Collection</Link><a href={`https://opensea.io/assets/base/${collection}/${tokenId}`} target="_blank" rel="noreferrer">OpenSea <ExternalLink/></a>{tokenId > 1n ? <Link href={`/nft/${collection}/${tokenId - 1n}`}>Previous</Link> : null}{tokenId < (minted.data ?? 0n) ? <Link href={`/nft/${collection}/${tokenId + 1n}`}>Next</Link> : null}</div>{metadata.attributes?.length ? <div className="pfp-traits">{metadata.attributes.map((trait, index) => <span key={`${trait.trait_type}-${index}`}><small>{trait.trait_type || "Trait"}</small><strong>{String(trait.value ?? "—")}</strong></span>)}</div> : null}<div className="nft-supply"><span>Minted <b>{String(minted.data ?? 0n)}</b></span><span>Collection supply <b>{String(max.data ?? 0n)}</b></span><span>Reveal <b>{revealed.data ? "Live" : "Hidden"}</b></span></div>{listingMatches && listing.data ? <section className="nft-quick-trade listed"><div><small>CURRENT PRICE</small><strong>{formatEther(listing.data[3])} ETH</strong></div>{isListingSeller ? <button className="button" disabled={isPending} onClick={() => void cancelSale()}>Cancel listing</button> : <button className="button primary" disabled={!isConnected || isPending} onClick={() => setCommerceDialog("buy")}><ShoppingBag/>Buy now</button>}</section> : ownsToken ? <section className="nft-quick-trade"><div><small>LIST FOR SALE</small><div className="nft-quick-list-fields"><div className="nft-input-suffix"><input aria-label="Sale price" min="0" type="number" value={salePrice} onChange={(event) => setSalePrice(event.target.value)}/><span>ETH</span></div><select aria-label="Listing duration" value={listingDays} onChange={(event) => setListingDays(event.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></div></div><button className="button primary" disabled={isPending || !isValidPositiveEth(salePrice)} onClick={() => setCommerceDialog("list")}>Review listing</button></section> : null}{!mintFinished ? <Link className="nft-inline-mint" href={`/nft/${collection}`}><Sparkles/>Primary mint is live · Open collection</Link> : null}</section>
    </div>
    <NFTOffersPanel collection={collection} tokenId={tokenId} standard="ERC721" ownsItem={ownsToken}/>
    {isCreator && !revealed.data ? <section className="card nft-action" id="creator-tools"><h2><Eye/>Creator reveal</h2><p>Paste the metadataBaseURI from your downloaded BlueFun reveal manifest.</p><div className="field"><label>Metadata base URI</label><input placeholder="ipfs://…/bluefun/" value={revealURI} onChange={(event) => setRevealURI(event.target.value)}/></div><label className="pfp-check"><input checked={freezeReveal} onChange={(event) => setFreezeReveal(event.target.checked)} type="checkbox"/><span><strong>Freeze on reveal</strong><small>This cannot be reversed.</small></span></label><button className="button" disabled={!revealURI.startsWith("ipfs://") || isPending} onClick={() => void reveal()}>Reveal collection</button></section> : null}
    {isCreator && revealed.data ? <section className="card nft-action" id="creator-tools"><h2><Eye/>Creator metadata control</h2>{metadataFrozen.data ? <p>Token metadata is permanently frozen. No wallet or platform can change it.</p> : <><p>Publish a replacement IPFS metadata directory, or permanently freeze the current metadata.</p><div className="field"><label>New metadata base URI</label><input placeholder="ipfs://…/bluefun/" value={revealURI} onChange={(event) => setRevealURI(event.target.value)}/></div><div className="nft-form-grid"><button className="button" disabled={!revealURI.startsWith("ipfs://") || isPending} onClick={() => void updateMetadata()}>Update metadata</button><button className="button" disabled={isPending} onClick={() => void freezeMetadataForever()}>Freeze permanently</button></div></>}</section> : null}
    {notice ? <p className="nft-status">{notice}</p> : null}<code className="nft-contract">{collection} / {String(tokenId)}</code>
    {commerceDialog && (commerceDialog === "list" || (listing.data && listingMatches)) ? <NFTCommerceDialog kind={commerceDialog} title={metadata.name || `Token #${tokenId}`} collectionName={name.data || "BlueFun PFP"} image={optimizedTokenImageUrl(metadata.image)} unitPrice={commerceDialog === "buy" && listing.data ? listing.data[3] : safeParseEther(salePrice)} quantity={1n} platformFeeBps={BigInt(marketplaceFeeBps.data ?? 80)} royaltyBps={BigInt(royaltyBps.data ?? 0)} durationDays={Number(listingDays)} needsApproval={approval.data?.toLowerCase() !== marketAddress.toLowerCase()} pending={isPending} onClose={() => setCommerceDialog(null)} onConfirm={() => void (commerceDialog === "buy" ? buy() : approveOrList())}/> : null}
  </div>;
}

function shortError(error: unknown) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 220) : "Transaction failed."; }
function safeParseEther(value: string) { try { return parseEther(value || "0"); } catch { return 0n; } }
function safeUnsignedBigInt(value: string) { return /^\d+$/.test(value) ? BigInt(value) : undefined; }
function safePositiveBigInt(value: string) { const parsed = safeUnsignedBigInt(value); return parsed && parsed > 0n ? parsed : undefined; }
function isValidPositiveEth(value: string) { try { return parseEther(value) > 0n; } catch { return false; } }
function remaining(limit: bigint, used: bigint) { return limit === 0n ? 2n ** 256n - 1n : limit > used ? limit - used : 0n; }
function minPositive(...values: bigint[]) { return values.reduce((smallest, value) => value < smallest ? value : smallest, values[0] ?? 0n); }
type CollectionMetadata = { description?: string; image?: string; external_link?: string; external_url?: string; socials?: { website?: string; x?: string; twitter?: string; telegram?: string } };
function socialsFromMetadata(metadata: CollectionMetadata) { return { ...metadata.socials, website: metadata.socials?.website || metadata.external_link || metadata.external_url }; }

type MarketListing = { listingId: string; tokenId: string; unitPrice: string; priceEth: string; remaining: string; marketplace: `0x${string}`; listedAt?: string };

function PFPTokenGrid({ collection, count }: { collection: `0x${string}`; count: number }) {
  const [listings, setListings] = useState<MarketListing[]>([]); const [status, setStatus] = useState<"all" | "listed" | "unlisted">("all");
  const [selected, setSelected] = useState<NFTQuickBuyItem>(); const [sort, setSort] = useState("listed"); const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const [view, setView] = useState<"grid" | "list">("grid"); const pageSize = view === "grid" ? 24 : 50;
  const listingRefreshRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const refresh = () => fetch(`/api/nft/listing?collection=${collection}&limit=2000`).then((response) => response.ok ? response.json() : { listings: [] }).then((data: { listings?: MarketListing[] }) => { if (active) setListings((data.listings || []).filter((item) => item.unitPrice && item.marketplace)); }).catch(() => undefined);
    listingRefreshRef.current = refresh; void refresh();
    return () => { active = false; listingRefreshRef.current = undefined; };
  }, [collection]);
  useRealtimeRefresh({ table: "nft_listings", filter: `collection=eq.${collection.toLowerCase()}`, fallbackMs: 60_000, onRefresh: () => listingRefreshRef.current?.() });
  const listingMap = useMemo(() => new Map(listings.map((listing) => [Number(listing.tokenId), listing])), [listings]);
  const tokens = useMemo(() => {
    const exact = /^#?\d+$/.test(search.trim()) ? Number(search.trim().replace("#", "")) : 0;
    const values = Array.from({ length: count }, (_, index) => index + 1).filter((id) => (!exact || id === exact) && (status === "all" || status === "listed" && listingMap.has(id) || status === "unlisted" && !listingMap.has(id)));
    values.sort((a, b) => {
      const aListing = listingMap.get(a); const bListing = listingMap.get(b);
      if (sort === "newest") return b - a; if (sort === "oldest") return a - b;
      if (sort === "listing-new") return new Date(bListing?.listedAt || 0).getTime() - new Date(aListing?.listedAt || 0).getTime();
      if (aListing && bListing && sort === "price-high") return Number(bListing.priceEth) - Number(aListing.priceEth);
      if (aListing && bListing) return Number(aListing.priceEth) - Number(bListing.priceEth);
      if (aListing) return -1; if (bListing) return 1; return a - b;
    });
    return values;
  }, [count, listingMap, search, sort, status]);
  const pages = Math.max(1, Math.ceil(tokens.length / pageSize)); const safePage = Math.min(page, pages); const visible = tokens.slice((safePage - 1) * pageSize, safePage * pageSize);
  const revealed = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "revealed", chainId: 8453, query: { staleTime: 30_000 } });
  const baseURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "baseURI", chainId: 8453, query: { enabled: Boolean(revealed.data), staleTime: 30_000 } });
  const placeholderURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "placeholderURI", chainId: 8453, query: { enabled: revealed.data === false, staleTime: 30_000 } });
  const tokenURI = (id: number) => revealed.data ? `${baseURI.data || ""}${id}` : placeholderURI.data || "";
  useEffect(() => setPage(1), [search, sort, status, view]);
  return <section className="nft-directory-panel nft-items-panel nft-marketplace-panel" id="collection-marketplace"><header><div><span>COLLECTION MARKETPLACE</span><h2>Explore, list and trade</h2><p>Active listings appear first. Select any NFT to view traits, ownership and trading controls.</p></div><div className="nft-market-stats"><strong>{count.toLocaleString()} ITEMS</strong><strong>{listings.length.toLocaleString()} LISTED</strong></div></header>
    <div className="nft-market-toolbar"><label><Search/><input aria-label="Search token ID" placeholder="Search by token ID" value={search} onChange={(event) => setSearch(event.target.value)}/></label><div className="nft-market-status"><button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>All</button><button className={status === "listed" ? "active" : ""} onClick={() => setStatus("listed")}>Listed <b>{listings.length}</b></button><button className={status === "unlisted" ? "active" : ""} onClick={() => setStatus("unlisted")}>Not listed</button></div><select aria-label="Sort NFTs" value={sort} onChange={(event) => setSort(event.target.value)}><option value="listed">Listed first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="listing-new">Newly listed</option><option value="newest">Recently minted</option><option value="oldest">Oldest</option></select><div className="nft-view-switch"><button aria-label="Grid view" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2/></button><button aria-label="List view" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><ListIcon/></button></div></div>
    {visible.length ? <div className={`nft-market-items ${view}`}>{visible.map((id) => <PFPTokenCard collection={collection} key={id} listing={listingMap.get(id)} tokenId={BigInt(id)} uri={tokenURI(id)} view={view} onBuy={setSelected}/>)}</div> : <div className="nft-directory-empty"><h3>{count ? "No NFTs match this view" : "No NFTs minted yet"}</h3><p>{count ? "Try a different status filter or token ID." : "The first collector will receive token #1 automatically."}</p></div>}
    {pages > 1 ? <footer className="nft-market-pagination"><span>Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, tokens.length)} of {tokens.length}</span><div><button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft/>Previous</button><b>Page {safePage} of {pages}</b><button disabled={safePage === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next<ChevronRight/></button></div></footer> : null}
    <NFTQuickBuyDialog item={selected} onClose={() => setSelected(undefined)} onPurchased={(purchased) => setListings((rows) => rows.filter((row) => row.listingId !== purchased.listingId || row.marketplace.toLowerCase() !== purchased.marketplace.toLowerCase()))}/>
  </section>;
}

function PFPTokenCard({ collection, tokenId, listing, uri, view, onBuy }: { collection: `0x${string}`; tokenId: bigint; listing?: MarketListing; uri: string; view: "grid" | "list"; onBuy: (item: NFTQuickBuyItem) => void }) {
  const [item, setItem] = useState<{ name?: string; image?: string; attributes?: unknown[] }>({});
  useEffect(() => { if (!uri) return; const controller = new AbortController(); fetch(nftMetadataUrl(uri), { signal: controller.signal }).then((response) => response.ok ? response.json() : {}).then(setItem).catch(() => undefined); return () => controller.abort(); }, [uri]);
  const image = optimizedTokenImageUrl(item.image);
  return <article className={`nft-collection-card nft-item-card ${listing ? "listed" : ""} ${view}`}>
    <Link className="nft-card-link" href={`/nft/${collection}/${tokenId}`} aria-label={`Open ${item.name || `Token #${tokenId}`}`}>
      <div className="nft-collection-cover">{image ? <img src={image} loading="lazy" decoding="async" alt={item.name || `Token #${tokenId}`}/> : <span><Sparkles/></span>}<b>#{String(tokenId)}</b></div>
      <div className="nft-collection-body"><div><small>ERC-721 · #{String(tokenId)}</small><h3>{item.name || `Token #${tokenId}`}</h3></div><footer><span>{listing ? <><small>PRICE</small><strong>{listing.priceEth} ETH</strong></> : "Not listed"}</span><code>{item.attributes?.length || 0} traits</code></footer></div>
    </Link>
    {listing ? <button className="nft-card-buy" type="button" onClick={() => onBuy({ collection, collectionName: "BlueFun collection", image, listingId: listing.listingId, marketplace: listing.marketplace, remaining: listing.remaining, standard: "ERC721", title: item.name || `Token #${tokenId}`, tokenId: String(tokenId), unitPrice: listing.unitPrice })}><span><b>Buy now</b><small>Instant checkout</small></span><strong>{listing.priceEth} ETH</strong></button> : null}
  </article>;
}
