"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Check, Clock3, Coins, Loader2, ShieldCheck, Tag, WalletCards, X } from "lucide-react";
import { formatEther, maxUint256, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useReadContract, useSignTypedData, useWriteContract } from "wagmi";
import { blueEditionAbi, bluePFPAbi, legacyNftAddresses, nftAddresses, nftCollectionFactoryAbi, nftOffersAbi, nftOffersEnabled, nftPFPFactoryAbi, wethOffersAbi } from "@/lib/nft-contracts";
import { nftOfferDomainFor, nftOfferTypes, serializeNFTOffer, type NFTOffer } from "@/lib/nft-offers";

type OfferRow = NFTOffer & { offersContract: Address; offerHash: Hex; signature: Hex; filledQuantity: bigint; remainingQuantity: bigint; createdAt: string };

export function NFTOffersPanel({ collection, tokenId, standard, ownsItem = false, mode = "item", compact = false }: {
  collection: Address; tokenId?: bigint; standard: "ERC721" | "ERC1155"; ownsItem?: boolean; mode?: "item" | "collection"; compact?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const [offers, setOffers] = useState<OfferRow[]>([]); const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false); const [price, setPrice] = useState("0.01");
  const [quantity, setQuantity] = useState("1"); const [duration, setDuration] = useState("30");
  const [fillQuantity, setFillQuantity] = useState<Record<string, string>>({}); const [status, setStatus] = useState("");
  const standardCode = standard === "ERC721" ? 1 : 2; const offerType = mode === "collection" ? 1 : 0;
  const parsedPrice = safeParseEther(price); const parsedQuantity = safePositiveBigInt(quantity) || 1n;
  const gross = parsedPrice * parsedQuantity;
  const currentEdition = useReadContract({ address: nftAddresses.collectionFactory, abi: nftCollectionFactoryAbi, functionName: "isBlueFunCollection", args: [collection], chainId: 8453, query: { enabled: standard === "ERC1155" } });
  const currentPFP = useReadContract({ address: nftAddresses.pfpFactory, abi: nftPFPFactoryAbi, functionName: "isBlueFunCollection", args: [collection], chainId: 8453, query: { enabled: standard === "ERC721" } });
  const registryResult = standard === "ERC721" ? currentPFP.data : currentEdition.data;
  const offersAddress = registryResult === false ? legacyNftAddresses.offers : nftAddresses.offers;
  const wethBalance = useReadContract({ address: nftAddresses.weth, abi: wethOffersAbi, functionName: "balanceOf", args: [address!], chainId: 8453, query: { enabled: Boolean(address) && nftOffersEnabled } });
  const wethAllowance = useReadContract({ address: nftAddresses.weth, abi: wethOffersAbi, functionName: "allowance", args: [address!, offersAddress], chainId: 8453, query: { enabled: Boolean(address) && nftOffersEnabled } });
  const pfpApproval = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "getApproved", args: [tokenId || 0n], chainId: 8453, query: { enabled: standard === "ERC721" && Boolean(address) && Boolean(tokenId) && nftOffersEnabled } });
  const editionApproval = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "isApprovedForAll", args: [address!, offersAddress], chainId: 8453, query: { enabled: standard === "ERC1155" && Boolean(address) && nftOffersEnabled } });
  const canCreate = isConnected && !(mode === "item" && ownsItem) && parsedPrice > 0n && parsedQuantity > 0n && !isWriting && !isSigning;

  const loadOffers = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({ collection }); if (mode === "item" && tokenId) query.set("tokenId", tokenId.toString());
    try { const response = await fetch(`/api/nft/offers?${query}`, { cache: "no-store" }); const data = await response.json() as { offers?: Array<Record<string, unknown>> }; setOffers((data.offers || []).map(parseOfferRow)); }
    catch { setOffers([]); } finally { setLoading(false); }
  }, [collection, mode, tokenId]);
  useEffect(() => { void loadOffers(); }, [loadOffers]);

  async function createOffer() {
    if (!address || !canCreate) return;
    try {
      setStatus("");
      if ((wethBalance.data ?? 0n) < gross) { setStatus(`Wrap at least ${formatEther(gross - (wethBalance.data ?? 0n))} ETH into WETH first.`); return; }
      if ((wethAllowance.data ?? 0n) < gross) {
        await writeContractAsync({ chainId: 8453, address: nftAddresses.weth, abi: wethOffersAbi, functionName: "approve", args: [offersAddress, maxUint256] });
        setStatus("WETH approval submitted. Create the offer after it confirms."); void wethAllowance.refetch(); return;
      }
      const now = BigInt(Math.floor(Date.now() / 1000)); const nonce = randomNonce();
      const offer: NFTOffer = { maker: address, taker: zeroAddress, recipient: address, collection, tokenId: offerType === 1 ? 0n : tokenId || 0n, unitPrice: parsedPrice, quantity: standard === "ERC721" && offerType === 0 ? 1n : parsedQuantity, startTime: now - 30n, endTime: now + BigInt(Number(duration)) * 86400n, nonce, standard: standardCode, offerType };
      const signature = await signTypedDataAsync({ domain: nftOfferDomainFor(offersAddress), types: nftOfferTypes, primaryType: "Offer", message: offer });
      const response = await fetch("/api/nft/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offer: serializeNFTOffer(offer), signature, offersContract: offersAddress }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Offer could not be saved.");
      setDialog(false); setStatus("Offer signed and published. WETH remains in your wallet until acceptance."); await loadOffers();
    } catch (error) { setStatus(shortError(error)); }
  }

  async function wrapWeth() {
    if (parsedPrice <= 0n) return;
    try { const required = gross > (wethBalance.data ?? 0n) ? gross - (wethBalance.data ?? 0n) : gross; await writeContractAsync({ chainId: 8453, address: nftAddresses.weth, abi: wethOffersAbi, functionName: "deposit", value: required }); setStatus("WETH deposit submitted. Continue after confirmation."); void wethBalance.refetch(); }
    catch (error) { setStatus(shortError(error)); }
  }

  async function accept(offer: OfferRow) {
    if (!address || !tokenId) return;
    try {
      const qty = standard === "ERC721" ? 1n : safePositiveBigInt(fillQuantity[offer.offerHash] || "1") || 1n;
      if (qty > offer.remainingQuantity) throw new Error(`Maximum remaining quantity is ${offer.remainingQuantity}.`);
      const offerContract = offer.offersContract;
      const approved = standard === "ERC721" ? pfpApproval.data?.toLowerCase() === offerContract.toLowerCase() : Boolean(editionApproval.data);
      if (!approved) {
        if (standard === "ERC721") await writeContractAsync({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "approve", args: [offerContract, tokenId] });
        else await writeContractAsync({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setApprovalForAll", args: [offerContract, true] });
        setStatus("Offer marketplace approval submitted. Accept after confirmation."); void pfpApproval.refetch(); void editionApproval.refetch(); return;
      }
      await writeContractAsync({ chainId: 8453, address: offerContract, abi: nftOffersAbi, functionName: "acceptOffer", args: [offerTuple(offer), tokenId, qty, offer.signature] });
      setStatus("Offer acceptance submitted. Settlement is atomic in WETH.");
    } catch (error) { setStatus(shortError(error)); }
  }

  async function cancel(offer: OfferRow) {
    try { await writeContractAsync({ chainId: 8453, address: offer.offersContract, abi: nftOffersAbi, functionName: "cancelOffer", args: [offerTuple(offer)] }); setStatus("Offer cancellation submitted."); }
    catch (error) { setStatus(shortError(error)); }
  }

  if (!nftOffersEnabled) return <section className="nft-offers-panel disabled"><header><div><span>WETH OFFERS</span><h2>{mode === "collection" ? "Collection offers" : "Offers"}</h2></div><ShieldCheck/></header><p>The security-tested offer module is ready and will activate when its verified Base deployment address is configured.</p></section>;

  return <section className={`nft-offers-panel ${compact ? "compact" : ""} ${ownsItem ? "owner-view" : ""}`}><header><div><span>NON-CUSTODIAL · WETH</span><h2>{mode === "collection" ? "Collection offers" : ownsItem ? "Offers received" : "Offers"}</h2><p>{mode === "collection" ? "Bid across the entire collection. Any eligible owner can accept from an item page." : ownsItem ? "Accept the best active bid for this NFT." : "Review item and collection bids for this NFT."}</p></div>{!(mode === "item" && ownsItem) ? <button className="button" disabled={!isConnected} onClick={() => setDialog(true)}><Tag/>Make {mode === "collection" ? "collection " : ""}offer</button> : null}</header>
    {!ownsItem ? <div className="nft-offer-balance"><WalletCards/><span><small>YOUR WETH</small><strong>{formatCompact(wethBalance.data ?? 0n)} WETH</strong></span><span><small>OPEN OFFERS</small><strong>{offers.length}</strong></span><BadgeCheck/></div> : null}
    {loading ? <p className="nft-offer-empty"><Loader2 className="spin"/>Loading offers…</p> : offers.length ? <div className="nft-offer-list">{offers.map((offer) => { const mine = address?.toLowerCase() === offer.maker.toLowerCase(); return <article key={offer.offerHash}><span><small>{offer.offerType === 1 ? "COLLECTION OFFER" : "ITEM OFFER"}</small><strong>{formatCompact(offer.unitPrice)} WETH</strong><em>{offer.remainingQuantity} remaining · expires {formatExpiry(offer.endTime)}</em></span><code>{shortAddress(offer.maker)}</code>{ownsItem && tokenId ? <div>{standard === "ERC1155" ? <input aria-label="Accept quantity" min="1" max={offer.remainingQuantity.toString()} value={fillQuantity[offer.offerHash] || "1"} onChange={(event) => setFillQuantity((current) => ({ ...current, [offer.offerHash]: event.target.value }))}/> : null}<button className="button primary" disabled={isWriting} onClick={() => void accept(offer)}><Check/>Accept</button></div> : mine ? <button className="button" disabled={isWriting} onClick={() => void cancel(offer)}>Cancel</button> : null}</article>; })}</div> : <p className="nft-offer-empty">No active offers yet.</p>}
    {status ? <p className="nft-status">{status}</p> : null}
    {dialog ? <div className="nft-dialog-backdrop" role="presentation"><section className="nft-commerce-dialog nft-offer-dialog" role="dialog" aria-modal="true" aria-labelledby="offer-title"><header><div className="list"><span><Coins/></span><div><small>SIGNED WETH ORDER</small><h2 id="offer-title">Make an offer</h2></div></div><button aria-label="Close" onClick={() => setDialog(false)}><X/></button></header><div className="nft-offer-form"><label>Price per NFT<div><input min="0" step="0.001" type="number" value={price} onChange={(event) => setPrice(event.target.value)}/><span>WETH</span></div></label>{standard === "ERC1155" || offerType === 1 ? <label>Quantity<input min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label> : null}<label>Duration<select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label></div><dl className="nft-dialog-summary"><div><dt>Total commitment</dt><dd>{formatCompact(gross)} WETH</dd></div><div><dt><Clock3/>Funds custody</dt><dd>Your wallet</dd></div></dl><p className="nft-dialog-proof"><ShieldCheck/>Signing is gasless. WETH moves only if an owner accepts before expiration.</p><footer><button className="button" onClick={() => void wrapWeth()}>Wrap ETH</button><button className="button primary" disabled={!canCreate} onClick={() => void createOffer()}>{isSigning || isWriting ? <Loader2 className="spin"/> : <Tag/>}{(wethAllowance.data ?? 0n) < gross ? "Approve WETH" : "Sign offer"}</button></footer></section></div> : null}
  </section>;
}

function offerTuple(offer: NFTOffer) { return { maker: offer.maker, taker: offer.taker, recipient: offer.recipient, collection: offer.collection, tokenId: offer.tokenId, unitPrice: offer.unitPrice, quantity: offer.quantity, startTime: offer.startTime, endTime: offer.endTime, nonce: offer.nonce, standard: offer.standard, offerType: offer.offerType }; }
function parseOfferRow(row: Record<string, unknown>): OfferRow { return { offersContract: String(row.offersContract || nftAddresses.offers) as Address, offerHash: String(row.offerHash) as Hex, signature: String(row.signature) as Hex, maker: String(row.maker) as Address, taker: String(row.taker) as Address, recipient: String(row.recipient) as Address, collection: String(row.collection) as Address, tokenId: BigInt(String(row.tokenId)), unitPrice: BigInt(String(row.unitPrice)), quantity: BigInt(String(row.quantity)), filledQuantity: BigInt(String(row.filledQuantity)), remainingQuantity: BigInt(String(row.remainingQuantity)), startTime: BigInt(String(row.startTime)), endTime: BigInt(String(row.endTime)), nonce: BigInt(String(row.nonce)), standard: Number(row.standard), offerType: Number(row.offerType), createdAt: String(row.createdAt) }; }
function safeParseEther(value: string) { try { return parseEther(value || "0"); } catch { return 0n; } }
function safePositiveBigInt(value: string) { return /^\d+$/.test(value) && BigInt(value) > 0n ? BigInt(value) : undefined; }
function randomNonce() { const random = crypto.getRandomValues(new Uint32Array(2)); return (BigInt(Date.now()) << 64n) | (BigInt(random[0]) << 32n) | BigInt(random[1]); }
function formatCompact(value: bigint) {
  const numeric = Number(formatEther(value));
  if (value > 0n && numeric < 0.00001) return "<0.00001";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 5 });
}
function formatExpiry(value: bigint) { const seconds = Number(value) - Math.floor(Date.now() / 1000); if (seconds < 3600) return `${Math.max(0, Math.floor(seconds / 60))}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function shortError(error: unknown) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 220) : "Offer action failed."; }
