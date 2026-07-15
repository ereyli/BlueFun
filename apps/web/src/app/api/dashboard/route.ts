import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { getDbWalletDashboard } from "@/lib/db-launches";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet")?.trim() || "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  }

  const dashboard = await getDbWalletDashboard(getAddress(wallet));
  return NextResponse.json(dashboard ?? { created: [], traded: [], indexed: false }, {
    headers: { "Cache-Control": "private, no-store" }
  });
}
