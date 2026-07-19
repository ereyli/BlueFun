"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatEther, type Address, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { ExternalLink, Gavel, Loader2, Tag } from "lucide-react";
import { nftOffersAbi, nftOffersEnabled } from "@/lib/nft-contracts";

type WalletOffer = {
  offersContract: Address; offerHash: Hex; maker: Address; taker: Address; recipient: Address; collection: Address; tokenId: string;
  unitPrice: string; quantity: string; remainingQuantity: string; startTime: string; endTime: string; nonce: string;
  standard: number; offerType: number; signature: Hex; ownedTokenId?: string;
};

export function NFTWalletOffers() {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [view, setView] = useState<"made" | "received">("made");
  const [made, setMade] = useState<WalletOffer[]>([]);
  const [received, setReceived] = useState<WalletOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

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
      await writeContractAsync({ chainId: 8453, address: offer.offersContract, abi: nftOffersAbi, functionName: "cancelOffer", args: [{
        maker: offer.maker, taker: offer.taker, recipient: offer.recipient, collection: offer.collection,
        tokenId: BigInt(offer.tokenId), unitPrice: BigInt(offer.unitPrice), quantity: BigInt(offer.quantity),
        startTime: BigInt(offer.startTime), endTime: BigInt(offer.endTime), nonce: BigInt(offer.nonce), standard: offer.standard, offerType: offer.offerType
      }] });
      setNotice("Offer cancellation submitted. It will disappear after confirmation.");
    } catch (error) { setNotice(error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 180) : "Cancellation failed."); }
  }

  const rows = view === "made" ? made : received;
  if (!nftOffersEnabled) return <section className="nft-directory-panel nft-dashboard-panel"><header><div><span><Gavel/>WETH ORDERBOOK</span><h2>Offers</h2></div></header><div className="nft-dashboard-list"><p>Offers activate after the verified Base contract is configured.</p></div></section>;
  return <section className="nft-directory-panel nft-dashboard-panel nft-wallet-offers"><header><div><span><Gavel/>WETH ORDERBOOK</span><h2>Offers</h2></div><div className="nft-market-status"><button className={view === "made" ? "active" : ""} onClick={() => setView("made")}>Made <b>{made.length}</b></button><button className={view === "received" ? "active" : ""} onClick={() => setView("received")}>Received <b>{received.length}</b></button></div></header><div className="nft-dashboard-list">
    {loading ? <p><Loader2 className="spin"/> Loading offers…</p> : rows.length ? rows.map((offer) => {
      const itemToken = offer.offerType === 1 ? offer.ownedTokenId : offer.tokenId;
      const href = itemToken ? `/nft/${offer.collection}/${itemToken}` : `/nft/${offer.collection}`;
      return <div className="nft-dashboard-row" key={offer.offerHash}><span className="nft-dashboard-thumb"><Tag/></span><span><strong>{offer.offerType === 1 ? "Collection offer" : `Offer for token #${offer.tokenId}`}</strong><small>{formatEther(BigInt(offer.unitPrice))} WETH each · {offer.remainingQuantity} remaining</small></span>{view === "made" ? <button className="button" disabled={isPending} onClick={() => void cancel(offer)}>Cancel</button> : <Link className="button" href={href}>Review <ExternalLink/></Link>}</div>;
    }) : <p>No active offers {view}.</p>}
  </div>{notice ? <p className="nft-status">{notice}</p> : null}</section>;
}
