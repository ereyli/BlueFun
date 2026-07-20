"use client";

import { CircleDollarSign, ShieldCheck } from "lucide-react";

export function NFTMarketplaceRevenue() {
  return <section className="nft-market-earnings">
    <div className="nft-market-earnings-icon"><CircleDollarSign/></div>
    <div className="nft-market-earnings-copy">
      <small>V3 AUTOMATIC SETTLEMENT</small>
      <h3>No marketplace balance to claim</h3>
      <p>Seller proceeds, creator royalties and platform fees are paid automatically in every successful sale.</p>
    </div>
    <ShieldCheck/>
  </section>;
}
