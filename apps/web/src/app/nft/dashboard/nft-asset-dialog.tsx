"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEther, parseEther, type Address } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { ExternalLink, ImageIcon, Loader2, ShieldCheck, ShoppingBag, Sparkles, Tag, X } from "lucide-react";
import { blueEditionAbi, bluePFPAbi, nftDeploymentForFactory, nftMarketplaceForDeployment, nftMarketplaceAbi, nftPFPMarketplaceAbi } from "@/lib/nft-contracts";
import { NFTOffersPanel } from "../nft-offers-panel";
import { nftMetadataUrl, optimizedTokenImageUrl } from "@/lib/token-metadata";

export type DashboardNFT = {
  collection: string;
  token_id: string;
  balance: string;
  metadataUri?: string;
  collectionInfo: { collection: string; factory?: string; name: string; symbol: string; standard: "ERC721" | "ERC1155" } | null;
};

type Metadata = { name?: string; description?: string; image?: string; attributes?: Array<{ trait_type?: string; value?: string | number }> };

export function NFTAssetDialog({ item, onClose }: { item: DashboardNFT; onClose: () => void }) {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const collection = item.collection as Address; const tokenId = BigInt(item.token_id);
  const standard = item.collectionInfo?.standard || "ERC1155";
  const marketAddress = nftMarketplaceForDeployment(nftDeploymentForFactory(item.collectionInfo?.factory), standard);
  const [metadata, setMetadata] = useState<Metadata>({}); const [listingId, setListingId] = useState("");
  const [listingMarketplace, setListingMarketplace] = useState<Address>(marketAddress);
  const [price, setPrice] = useState("0.1"); const [quantity, setQuantity] = useState("1"); const [days, setDays] = useState("30"); const [notice, setNotice] = useState("");
  const parsedListingId = /^\d+$/.test(listingId) ? BigInt(listingId) : 0n;
  const pfpApproval = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "getApproved", args: [tokenId], chainId: 8453, query: { enabled: standard === "ERC721" } });
  const editionApproval = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "isApprovedForAll", args: [address!, marketAddress], chainId: 8453, query: { enabled: standard === "ERC1155" && Boolean(address) } });
  const pfpRevealed = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "revealed", chainId: 8453, query: { enabled: standard === "ERC721" } });
  const pfpBaseURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "baseURI", chainId: 8453, query: { enabled: standard === "ERC721" && pfpRevealed.data === true } });
  const pfpPlaceholderURI = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "placeholderURI", chainId: 8453, query: { enabled: standard === "ERC721" && pfpRevealed.data === false } });
  const editionUri = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "uri", args: [tokenId], chainId: 8453, query: { enabled: standard === "ERC1155" } });
  const pfpListing = useReadContract({ address: listingMarketplace, abi: nftPFPMarketplaceAbi, functionName: "listings", args: [parsedListingId], chainId: 8453, query: { enabled: standard === "ERC721" && parsedListingId > 0n } });
  const editionListing = useReadContract({ address: listingMarketplace, abi: nftMarketplaceAbi, functionName: "listings", args: [parsedListingId], chainId: 8453, query: { enabled: standard === "ERC1155" && parsedListingId > 0n } });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const pfpActive = Boolean(pfpListing.data && pfpListing.data[1].toLowerCase() === collection.toLowerCase() && pfpListing.data[2] === tokenId && !pfpListing.data[6] && !pfpListing.data[7] && pfpListing.data[5] > now);
  const editionActive = Boolean(editionListing.data && editionListing.data[1].toLowerCase() === collection.toLowerCase() && editionListing.data[2] === tokenId && editionListing.data[6] > 0n && !editionListing.data[7] && editionListing.data[5] > now);
  const active = standard === "ERC721" ? pfpActive : editionActive;
  const activePrice = standard === "ERC721" ? pfpListing.data?.[3] : editionListing.data?.[3];
  const approvalReady = standard === "ERC721" ? pfpApproval.data?.toLowerCase() === marketAddress.toLowerCase() : Boolean(editionApproval.data);
  const itemTitle = metadata.name || `${item.collectionInfo?.name || "NFT"} #${item.token_id}`;
  const image = optimizedTokenImageUrl(metadata.image);
  const attributes = useMemo(() => (metadata.attributes || []).slice(0, 8), [metadata.attributes]);

  useEffect(() => {
    document.body.classList.add("nft-dialog-open");
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.classList.remove("nft-dialog-open"); document.removeEventListener("keydown", closeOnEscape); };
  }, [onClose]);
  const metadataUri = standard === "ERC721"
    ? pfpRevealed.data === true ? `${pfpBaseURI.data || ""}${tokenId}` : pfpRevealed.data === false ? pfpPlaceholderURI.data || "" : ""
    : editionUri.data || item.metadataUri;
  useEffect(() => {
    if (!metadataUri) return;
    fetch(nftMetadataUrl(metadataUri)).then((response) => response.ok ? response.json() : {}).then(setMetadata).catch(() => undefined);
  }, [metadataUri]);
  useEffect(() => {
    fetch(`/api/nft/listing?collection=${collection}&tokenId=${tokenId}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : {}).then((data: { listingId?: string; marketplace?: Address }) => { setListingId(data.listingId || ""); if (data.marketplace) setListingMarketplace(data.marketplace); }).catch(() => undefined);
  }, [collection, tokenId]);

  async function approveOrList() {
    try {
      setNotice("");
      const salePrice = parseEther(price || "0"); const saleQuantity = /^\d+$/.test(quantity) ? BigInt(quantity) : 0n;
      if (salePrice <= 0n || (standard === "ERC1155" && (saleQuantity <= 0n || saleQuantity > BigInt(item.balance)))) throw new Error("Enter a valid price and quantity.");
      if (!approvalReady) {
        if (standard === "ERC721") await writeContractAsync({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "approve", args: [marketAddress, tokenId] });
        else await writeContractAsync({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setApprovalForAll", args: [marketAddress, true] });
        setNotice("Marketplace approval submitted. List after confirmation."); void pfpApproval.refetch(); void editionApproval.refetch(); return;
      }
      const start = BigInt(Math.floor(Date.now() / 1000)); const end = start + BigInt(Number(days) || 30) * 86400n;
      if (standard === "ERC721") await writeContractAsync({ chainId: 8453, address: marketAddress, abi: nftPFPMarketplaceAbi, functionName: "createListing", args: [collection, tokenId, salePrice, start, end] });
      else await writeContractAsync({ chainId: 8453, address: marketAddress, abi: nftMarketplaceAbi, functionName: "createListing", args: [collection, tokenId, saleQuantity, salePrice, start, end] });
      setNotice("Listing submitted. It will appear after confirmation.");
    } catch (error) { setNotice(shortError(error)); }
  }

  async function cancelListing() {
    try {
      if (!parsedListingId) return;
      if (standard === "ERC721") await writeContractAsync({ chainId: 8453, address: listingMarketplace, abi: nftPFPMarketplaceAbi, functionName: "cancelListing", args: [parsedListingId] });
      else await writeContractAsync({ chainId: 8453, address: listingMarketplace, abi: nftMarketplaceAbi, functionName: "cancelListing", args: [parsedListingId] });
      setNotice("Listing cancellation submitted.");
    } catch (error) { setNotice(shortError(error)); }
  }

  return <div className="nft-dialog-backdrop nft-asset-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="nft-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-dialog-title"><header><div><span><ImageIcon/></span><div><small>YOUR NFT · BASE</small><h2 id="asset-dialog-title">Manage asset</h2></div></div><button aria-label="Close" onClick={onClose}><X/></button></header><div className="nft-asset-dialog-grid"><div className="nft-asset-preview">{image ? <img src={image} alt={itemTitle}/> : <Sparkles/>}<span>{standard === "ERC721" ? "ERC-721" : `ERC-1155 · ${item.balance} owned`}</span></div><div className="nft-asset-workspace"><section className="nft-asset-summary"><span>{item.collectionInfo?.name || shortAddress(collection)}</span><h3>{itemTitle}</h3><p>{metadata.description || "Creator-owned NFT on Base."}</p><div><Link href={`/nft/${collection}/${tokenId}`} onClick={onClose}>Full details</Link><a href={`https://opensea.io/assets/base/${collection}/${tokenId}`} target="_blank" rel="noreferrer">OpenSea <ExternalLink/></a></div>{attributes.length ? <dl>{attributes.map((attribute, index) => <div key={`${attribute.trait_type}-${index}`}><dt>{attribute.trait_type || "Trait"}</dt><dd>{String(attribute.value ?? "—")}</dd></div>)}</dl> : null}</section><section className="nft-asset-sale"><header><div><small>FIXED PRICE</small><h3>{active ? "Active listing" : "List for sale"}</h3></div><Tag/></header>{active && activePrice !== undefined ? <div className="nft-active-listing"><strong>{formatEther(activePrice)} ETH</strong><span>{standard === "ERC1155" ? `${String(editionListing.data?.[6] ?? 0n)} available` : "1 item"}</span><button className="button" disabled={isPending} onClick={() => void cancelListing()}>{isPending ? <Loader2 className="spin"/> : null}Cancel listing</button></div> : <><div className={`nft-asset-sale-fields ${standard === "ERC1155" ? "three" : "two"}`}>{standard === "ERC1155" ? <label>Quantity<input min="1" max={item.balance} value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label> : null}<label>Price<div><input min="0" step="0.001" value={price} onChange={(event) => setPrice(event.target.value)}/><span>ETH</span></div></label><label>Duration<select value={days} onChange={(event) => setDays(event.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label></div><button className="button primary" disabled={isPending} onClick={() => void approveOrList()}>{isPending ? <Loader2 className="spin"/> : <ShoppingBag/>}{approvalReady ? "List for sale" : "Approve marketplace"}</button><p><ShieldCheck/>NFT remains in your wallet until sold.</p></>}</section><NFTOffersPanel collection={collection} tokenId={tokenId} standard={standard} ownsItem compact/></div></div>{notice ? <p className="nft-status">{notice}</p> : null}</section></div>;
}

function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function shortError(error: unknown) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 220) : "NFT action failed."; }
