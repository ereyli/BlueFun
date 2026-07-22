import { NextResponse } from "next/server";
import { chainIdFromParam } from "@/lib/chain-slug";

export const revalidate = 30;

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  priceNative?: string;
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  baseToken?: { address?: string };
};

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const chainParam = new URL(request.url).searchParams.get("chain");
  const chainId = chainIdFromParam(chainParam);
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return NextResponse.json({ pair: null }, { status: 400 });
  }
  if (!chainParam || !["base", "robinhood", "monad", "8453", "4663", "143"].includes(chainParam.toLowerCase())) {
    return NextResponse.json({ pair: null }, { status: 400 });
  }
  if (chainId === 4663) {
    // DexScreener does not expose Robinhood Chain pairs through the Base endpoint.
    // Robinhood graduated pricing is sourced from indexed Uniswap v4 swaps instead.
    return NextResponse.json({ pair: null });
  }
  try {
    const dexChain = chainId === 143 ? "monad" : "base";
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/${dexChain}/${token}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 30 }
    });
    if (!response.ok) throw new Error(`Dexscreener returned ${response.status}`);

    const pairs = await response.json() as DexPair[];
    const normalizedToken = token.toLowerCase();
    const pair = pairs
      .filter((item) => item.chainId === dexChain && item.baseToken?.address?.toLowerCase() === normalizedToken)
      .sort((a, b) => pairScore(b) - pairScore(a))[0];

    if (!pair) return NextResponse.json({ pair: null });

    return NextResponse.json({
      pair: {
        dexId: pair.dexId || "",
        url: pair.url || "",
        pairAddress: pair.pairAddress || "",
        priceNative: Number(pair.priceNative),
        priceUsd: Number(pair.priceUsd),
        marketCap: Number(pair.marketCap ?? pair.fdv),
        liquidityUsd: Number(pair.liquidity?.usd)
      }
    });
  } catch {
    return NextResponse.json({ pair: null }, { status: 503 });
  }
}

function pairScore(pair: DexPair) {
  const dexScore = pair.dexId?.toLowerCase().includes("uniswap") ? 1_000_000_000 : 0;
  return dexScore + (Number(pair.liquidity?.usd) || 0);
}
