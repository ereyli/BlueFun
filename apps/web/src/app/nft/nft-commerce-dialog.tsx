"use client";

import { useEffect } from "react";
import { BadgeCheck, Clock3, ShieldCheck, ShoppingBag, Tag, X } from "lucide-react";
import { formatEther } from "viem";

type CommerceDialogProps = {
  kind: "buy" | "list";
  title: string;
  collectionName: string;
  image?: string;
  unitPrice: bigint;
  quantity: bigint;
  platformFeeBps: bigint;
  royaltyBps: bigint;
  durationDays?: number;
  needsApproval?: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function NFTCommerceDialog(props: CommerceDialogProps) {
  const gross = props.unitPrice * props.quantity;
  const platformFee = gross * props.platformFeeBps / 10_000n;
  const royalty = gross * props.royaltyBps / 10_000n;
  const sellerReceives = gross > platformFee + royalty ? gross - platformFee - royalty : 0n;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !props.pending) props.onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("nft-dialog-open");
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.classList.remove("nft-dialog-open"); };
  }, [props]);

  return <div className="nft-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.pending) props.onClose(); }}>
    <section aria-labelledby="nft-dialog-title" aria-modal="true" className="nft-commerce-dialog" role="dialog">
      <header><div className={props.kind}><span>{props.kind === "buy" ? <ShoppingBag/> : <Tag/>}</span><div><small>{props.kind === "buy" ? "SECURE CHECKOUT" : "CREATE LISTING"}</small><h2 id="nft-dialog-title">{props.kind === "buy" ? "Review purchase" : "Review listing"}</h2></div></div><button aria-label="Close" disabled={props.pending} onClick={props.onClose}><X/></button></header>
      <div className="nft-dialog-item">{props.image ? <img src={props.image} alt=""/> : <span><ShoppingBag/></span>}<div><small>{props.collectionName}</small><strong>{props.title}</strong><code>Base · Verified contract</code></div><BadgeCheck/></div>
      <dl className="nft-dialog-summary">
        <div><dt>Unit price</dt><dd>{formatAmount(props.unitPrice)} ETH</dd></div>
        {props.quantity > 1n ? <div><dt>Quantity</dt><dd>{String(props.quantity)}</dd></div> : null}
        <div className="total"><dt>{props.kind === "buy" ? "You pay" : "Sale total"}</dt><dd>{formatAmount(gross)} ETH</dd></div>
        {props.kind === "list" ? <><div><dt>BlueFun fee</dt><dd>{formatBps(props.platformFeeBps)} · {formatAmount(platformFee)} ETH</dd></div><div><dt>Creator royalty</dt><dd>{formatBps(props.royaltyBps)} · {formatAmount(royalty)} ETH</dd></div><div className="receive"><dt>You receive</dt><dd>{formatAmount(sellerReceives)} ETH</dd></div></> : null}
        {props.kind === "list" && props.durationDays ? <div><dt><Clock3/> Duration</dt><dd>{props.durationDays} days</dd></div> : null}
      </dl>
      <p className="nft-dialog-proof"><ShieldCheck/>BlueFun never takes custody. Your wallet shows the final network transaction before signing.</p>
      <footer><button className="button" disabled={props.pending} onClick={props.onClose}>Cancel</button><button className="button primary" disabled={props.pending} onClick={props.onConfirm}>{props.pending ? "Waiting for wallet…" : props.kind === "buy" ? "Confirm purchase" : props.needsApproval ? "Approve marketplace" : "Create listing"}</button></footer>
    </section>
  </div>;
}

function formatAmount(value: bigint) {
  const formatted = formatEther(value);
  const [whole, decimals = ""] = formatted.split(".");
  return decimals ? `${whole}.${decimals.slice(0, 6).replace(/0+$/, "") || "0"}` : whole;
}

function formatBps(value: bigint) {
  const number = Number(value) / 100;
  return `${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
