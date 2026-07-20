import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "viem";
import { nftAddresses } from "@/lib/nft-contracts";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("address") || "";
  if (!isAddress(value)) return NextResponse.json({ error: "Invalid collection address." }, { status: 400 });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "Collection index is unavailable." }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.from("nft_collections")
    .select("collection,factory,name,symbol,standard,initial_max_supply")
    .eq("chain_id", 8453)
    .eq("collection", getAddress(value).toLowerCase())
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Collection lookup failed." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This is not an indexed BlueFun collection." }, { status: 404 });
  const currentFactories = new Set([
    nftAddresses.collectionFactory.toLowerCase(),
    nftAddresses.pfpFactory.toLowerCase()
  ]);
  if (!currentFactories.has(String(data.factory).toLowerCase())) {
    return NextResponse.json({ error: "This collection is not part of the current BlueFun NFT deployment." }, { status: 404 });
  }
  return NextResponse.json({ collection: data }, { headers: { "cache-control": "public, max-age=15" } });
}
