import { NextRequest, NextResponse } from "next/server";
import { getStockAssets } from "@/lib/stock-assets";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const chainId = Number(request.nextUrl.searchParams.get("chainId"));
  if (chainId !== 8453 && chainId !== 4663) {
    return NextResponse.json({ error: "Stock pairs are available on Base and Robinhood Chain." }, { status: 400 });
  }
  try {
    const assets = await getStockAssets(chainId);
    return NextResponse.json(
      { chainId, assets, count: assets.length, source: chainId === 8453 ? "Base B20 registry" : "Robinhood RHJ API" },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stock registry is temporarily unavailable." },
      { status: 502 }
    );
  }
}
