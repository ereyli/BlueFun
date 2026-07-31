import { NextResponse } from "next/server";
import { chainIdFromParam } from "@/lib/chain-slug";
import { getNativeUsdPrice, nativeSymbolForChain } from "@/lib/native-usd";

export const revalidate = 30;

export async function GET(request: Request) {
  const chainId = chainIdFromParam(new URL(request.url).searchParams.get("chain"));
  const symbol = nativeSymbolForChain(chainId);
  const nativeUsd = await getNativeUsdPrice(chainId);
  return NextResponse.json(
    { nativeUsd, symbol, currency: "USD" },
    { status: nativeUsd === null ? 503 : 200 }
  );
}
