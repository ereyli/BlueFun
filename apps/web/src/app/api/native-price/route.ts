import { NextResponse } from "next/server";
import { chainIdFromParam } from "@/lib/chain-slug";

export const revalidate = 30;

export async function GET(request: Request) {
  const chainId = chainIdFromParam(new URL(request.url).searchParams.get("chain"));
  const symbol = chainId === 988 ? "USDT0" : chainId === 143 ? "MON" : "ETH";
  try {
    if (chainId === 988) {
      return NextResponse.json({ nativeUsd: 1, symbol, currency: "USD" });
    }
    if (chainId === 143) {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd", {
        headers: { accept: "application/json" },
        next: { revalidate: 30 }
      });
      if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
      const payload = await response.json() as { monad?: { usd?: number } };
      const amount = Number(payload.monad?.usd);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid MON price");
      return NextResponse.json({ nativeUsd: amount, symbol, currency: "USD" });
    }
    const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
      headers: { accept: "application/json" },
      next: { revalidate: 30 }
    });
    if (!response.ok) throw new Error(`Coinbase returned ${response.status}`);
    const payload = await response.json() as { data?: { amount?: string; currency?: string } };
    const amount = Number(payload.data?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid ${symbol} price`);
    return NextResponse.json({ nativeUsd: amount, symbol, currency: payload.data?.currency || "USD" });
  } catch {
    return NextResponse.json({ nativeUsd: null, symbol, currency: "USD" }, { status: 503 });
  }
}
