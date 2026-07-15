import { NextResponse } from "next/server";
import { getBlueStakingOverview } from "@/lib/blue-staking";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getBlueStakingOverview();
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("[blue-staking] overview failed", error);
    return NextResponse.json({ error: "Live staking data is temporarily unavailable." }, { status: 503 });
  }
}
