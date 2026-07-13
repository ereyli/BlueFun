import { NextResponse } from "next/server";
import { getDbRecentBuyActivity } from "@/lib/db-launches";
import { chainIdFromParam } from "@/lib/chain-slug";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const chainParam = new URL(request.url).searchParams.get("chain");
  if (!chainParam || !["base", "robinhood", "8453", "4663"].includes(chainParam.toLowerCase())) {
    return NextResponse.json({ activity: [] }, { status: 400 });
  }
  const chainId = chainIdFromParam(chainParam);

  const activity = await getDbRecentBuyActivity(chainId);
  return NextResponse.json({ activity: activity ?? [] }, {
    headers: { "cache-control": "public, s-maxage=2, stale-while-revalidate=4" }
  });
}
