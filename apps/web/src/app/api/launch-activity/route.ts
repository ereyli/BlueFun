import { NextResponse } from "next/server";
import { getDbRecentBuyActivity } from "@/lib/db-launches";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const chainId = Number(new URL(request.url).searchParams.get("chain"));
  if (chainId !== 8453 && chainId !== 4663) {
    return NextResponse.json({ activity: [] }, { status: 400 });
  }

  const activity = await getDbRecentBuyActivity(chainId);
  return NextResponse.json({ activity: activity ?? [] }, {
    headers: { "cache-control": "public, s-maxage=2, stale-while-revalidate=4" }
  });
}
