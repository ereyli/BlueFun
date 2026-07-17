import { NextResponse } from "next/server";
import { getBlueStakingOverview } from "@/lib/blue-staking";
import { getDbBlueStakingOverview } from "@/lib/db-launches";
import { blueStakingAddresses } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getDbBlueStakingOverview(8453, blueStakingAddresses.vault);
    if (snapshot) {
      return NextResponse.json(snapshot, {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
          "X-BlueFun-Data-State": snapshot.isStale ? "stale" : "fresh"
        }
      });
    }
    const data = await getBlueStakingOverview();
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("[blue-staking] overview failed", error);
    return NextResponse.json({ error: "Live staking data is temporarily unavailable." }, { status: 503 });
  }
}
