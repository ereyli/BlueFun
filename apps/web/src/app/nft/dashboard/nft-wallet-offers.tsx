"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatEther, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { Check, ExternalLink, Gavel, Loader2, Tag } from "lucide-react";
import { blueEditionAbi, bluePFPAbi, nftOffersAbi, nftOffersEnabled } from "@/lib/nft-contracts";

type WalletOffer = {
  offersContract: Address; offerHash: Hex; maker: Address; taker: Address; recipient: Address; collection: Address; tokenId: string;
  unitPrice: string; quantity: string; remainingQuantity: string; startTime: string; endTime: string; nonce: string;
  standard: number; offerType: number; signature: Hex; ownedTokenId?: string;
};

export function NFTWalletOffers() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: 8453 });
  const { writeContractAsync, isPending } = useWriteContract();
  const [view, setView] = useState<"made" | "received">("made");
  const [made, setMade] = useState<WalletOffer[]>([]);
  const [received, setReceived] = useState<WalletOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [confirmOffer, setConfirmOffer] = useState("");
  const [pendingOffer, setPendingOffer] = useState("");

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController(); setLoading(true);
    Promise.all([
      fetch(`/api/nft/offers?maker=${address}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : { offers: [] }),
      fetch(`/api/nft/offers?owner=${address}`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : { offers: [] })
    ]).then(([makerData, ownerData]: [{ offers?: WalletOffer[] }, { offers?: WalletOffer[] }]) => {
      setMade(makerData.offers || []);
      setReceived((ownerData.offers || []).filter((offer) => offer.maker.toLowerCase() !== address.toLowerCase()));
    }).catch(() => undefined).finally(() => setLoading(false));
    return () => controller.abort();
  }, [address]);

  async function cancel(offer: WalletOffer) {
    try {
      setPendingOffer(offer.offerHash);
      const hash = await writeContractAsync({ chainId: 8453, address: offer.offersContract, abi: nftOffersAbi, functionName: "cancelOffer", args: [{
        maker: offer.maker, taker: offer.taker, recipient: offer.recipient, collection: offer.collection,
        tokenId: BigInt(offer.tokenId), unitPrice: BigInt(offer.unitPrice), quantity: BigInt(offer.quantity),
        startTime: BigInt(offer.startTime), endTime: BigInt(offer.endTime), nonce: BigInt(offer.nonce), standard: offer.standard, offerType: offer.offerType
      }] });
      setNotice("Offer cancellation submitted. Waiting for Base confirmation…");
      await publicClient?.waitForTransactionReceipt({ hash });
      setMade((current) => current.filter((item) => item.offerHash !== offer.offerHash));
      setNotice("Offer cancelled successfully.");
    } catch (error) { setNotice(shortError(error, "Cancellation failed.")); }
    finally { setPendingOffer(""); }
  }

  async function accept(offer: WalletOffer) {
    if (!address || !offer.ownedTokenId) return;
    if (confirmOffer !== offer.offerHash) { setConfirmOffer(offer.offerHash); return; }
    const tokenId = BigInt(offer.ownedTokenId);
    try {
      setPendingOffer(offer.offerHash); setNotice("");
      if (offer.standard === 1) {
        const approved = await publicClient?.readContract({ address: offer.collection, abi: bluePFPAbi, functionName: "getApproved", args: [tokenId] });
        if (approved?.toLowerCase() !== offer.offersContract.toLowerCase()) {
          const approvalHash = await writeContractAsync({ chainId: 8453, address: offer.collection, abi: bluePFPAbi, functionName: "approve", args: [offer.offersContract, tokenId] });
          setNotice("NFT approval submitted. Waiting for confirmation…");
          await publicClient?.waitForTransactionReceipt({ hash: approvalHash });
        }
      } else {
        const approved = await publicClient?.readContract({ address: offer.collection, abi: blueEditionAbi, functionName: "isApprovedForAll", args: [address, offer.offersContract] });
        if (!approved) {
          const approvalHash = await writeContractAsync({ chainId: 8453, address: offer.collection, abi: blueEditionAbi, functionName: "setApprovalForAll", args: [offer.offersContract, true] });
          setNotice("Collection approval submitted. Waiting for confirmation…");
          await publicClient?.waitForTransactionReceipt({ hash: approvalHash });
        }
      }
      const hash = await writeContractAsync({
        chainId: 8453,
        address: offer.offersContract,
        abi: nftOffersAbi,
        functionName: "acceptOffer",
        args: [offerTuple(offer), tokenId, 1n, offer.signature]
      });
      setNotice("Offer acceptance submitted. Waiting for atomic WETH settlement…");
      await publicClient?.waitForTransactionReceipt({ hash });
      setReceived((current) => current.flatMap((item) => {
        if (item.offerHash !== offer.offerHash) return [item];
        const remaining = BigInt(item.remainingQuantity) - 1n;
        return remaining > 0n ? [{ ...item, remainingQuantity: remaining.toString() }] : [];
      }));
      setConfirmOffer(""); setNotice("Offer accepted. NFT and WETH settlement confirmed.");
    } catch (error) { setNotice(shortError(error, "Offer acceptance failed.")); }
    finally { setPendingOffer(""); }
  }

  const rows = view === "made" ? made : received;
  if (!nftOffersEnabled) return <section className="nft-directory-panel nft-dashboard-panel"><header><div><span><Gavel/>WETH ORDERBOOK</span><h2>Offers</h2></div></header><div className="nft-dashboard-list"><p>Offers activate after the verified Base contract is configured.</p></div></section>;
  return <section className="nft-directory-panel nft-dashboard-panel nft-wallet-offers"><header><div><span><Gavel/>WETH ORDERBOOK</span><h2>Offers</h2></div><div className="nft-market-status"><button className={view === "made" ? "active" : ""} onClick={() => setView("made")}>Made <b>{made.length}</b></button><button className={view === "received" ? "active" : ""} onClick={() => setView("received")}>Received <b>{received.length}</b></button></div></header><div className="nft-dashboard-list">
    {loading ? <p><Loader2 className="spin"/> Loading offers…</p> : rows.length ? rows.map((offer) => {
      const itemToken = offer.offerType === 1 ? offer.ownedTokenId : offer.tokenId;
      const href = itemToken ? `/nft/${offer.collection}/${itemToken}` : `/nft/${offer.collection}`;
      return <div className="nft-dashboard-row" key={offer.offerHash}><span className="nft-dashboard-thumb"><Tag/></span><span><strong>{offer.offerType === 1 ? `Collection offer · token #${offer.ownedTokenId || "—"}` : `Offer for token #${offer.tokenId}`}</strong><small>{formatEther(BigInt(offer.unitPrice))} WETH each · {offer.remainingQuantity} remaining</small></span><div className="nft-dashboard-row-actions"><Link className="button" href={href}>View <ExternalLink/></Link>{view === "made" ? <button className="button" disabled={isPending} onClick={() => void cancel(offer)}>{pendingOffer === offer.offerHash ? <Loader2 className="spin"/> : null}Cancel</button> : <button className={`button ${confirmOffer === offer.offerHash ? "primary" : ""}`} disabled={isPending || !offer.ownedTokenId} onClick={() => void accept(offer)}>{pendingOffer === offer.offerHash ? <Loader2 className="spin"/> : <Check/>}{confirmOffer === offer.offerHash ? `Confirm ${formatEther(BigInt(offer.unitPrice))} WETH` : "Accept"}</button>}</div></div>;
    }) : <p>No active offers {view}.</p>}
  </div>{notice ? <p className="nft-status">{notice}</p> : null}</section>;
}

function offerTuple(offer: WalletOffer) {
  return {
    maker: offer.maker, taker: offer.taker, recipient: offer.recipient, collection: offer.collection,
    tokenId: BigInt(offer.tokenId), unitPrice: BigInt(offer.unitPrice), quantity: BigInt(offer.quantity),
    startTime: BigInt(offer.startTime), endTime: BigInt(offer.endTime), nonce: BigInt(offer.nonce),
    standard: offer.standard, offerType: offer.offerType
  };
}
function shortError(error: unknown, fallback: string) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 220) : fallback; }
