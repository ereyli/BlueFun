import type { Metadata } from "next";
import { Suspense } from "react";
import { BlueDexClient } from "./bluedex-client";

export const metadata: Metadata = {
  title: "BlueDEX | B20",
  description: "Swap tokens and manage BlueDEX V2 liquidity on Base and Robinhood Chain."
};

export default function BlueDexPage() {
  return <Suspense fallback={<div className="bluedex-loading">Loading BlueDEX…</div>}><BlueDexClient /></Suspense>;
}
