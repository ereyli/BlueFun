import { NextResponse } from "next/server";
import { getBlueTransparency } from "@/lib/blue-transparency";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getBlueTransparency();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Live onchain data is temporarily unavailable." }, { status: 503 });
  }
}
