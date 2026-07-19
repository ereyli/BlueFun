import { NextResponse } from "next/server";
import { isAddress } from "viem";

export function GET(request: Request) {
  const url = new URL(request.url); const collection = url.searchParams.get("collection") || "";
  const tokenId = url.searchParams.get("tokenId") || "1";
  return NextResponse.redirect(new URL(isAddress(collection) && /^\d+$/.test(tokenId) ? `/nft/${collection}/${tokenId}` : "/nft", url));
}
