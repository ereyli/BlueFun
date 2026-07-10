import { NextResponse } from "next/server";
import { getDbLaunches } from "@/lib/db-launches";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chain"));
  const cursor = params.get("cursor") || undefined;
  if ((chainId !== 8453 && chainId !== 4663) || (cursor && !/^\d+$/.test(cursor))) {
    return NextResponse.json({ launches: [], hasMore: false }, { status: 400 });
  }
  const launches = await getDbLaunches(chainId, { cursor, limit: 40 });
  if (!launches) return NextResponse.json({ launches: [], hasMore: false }, { status: 503 });
  return NextResponse.json({ launches, hasMore: launches.length === 40 });
}
