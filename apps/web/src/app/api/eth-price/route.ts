import { NextResponse } from "next/server";

export const revalidate = 30;

export async function GET() {
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      headers: { accept: "application/json" },
      next: { revalidate: 30 }
    });
    if (!response.ok) throw new Error(`Coinbase returned ${response.status}`);

    const payload = await response.json() as { data?: { amount?: string; currency?: string } };
    const amount = Number(payload.data?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid ETH price");

    return NextResponse.json({ ethUsd: amount, currency: payload.data?.currency || "USD" });
  } catch {
    return NextResponse.json({ ethUsd: null, currency: "USD" }, { status: 503 });
  }
}
