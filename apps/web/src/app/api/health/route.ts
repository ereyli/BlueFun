import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "bluefun-web",
      protocol: process.env.NEXT_PUBLIC_NFT_PROTOCOL_VERSION || "unknown"
    },
    { headers: { "cache-control": "no-store" } }
  );
}

