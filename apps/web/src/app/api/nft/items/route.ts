import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "viem";
import { nftAddresses } from "@/lib/nft-contracts";
import { cachedResponse } from "@/lib/server/response-cache";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const value = search.get("collection") || "";
  const requestedLimit = Number(search.get("limit") || "500");
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(2000, Math.max(1, requestedLimit)) : 500;
  if (!isAddress(value)) return NextResponse.json({ error: "Invalid collection address." }, { status: 400 });
  const collection = getAddress(value).toLowerCase();
  return cachedResponse(`nft-items:${collection}:${limit}`, 5_000, () => loadItems(collection, limit));
}

async function loadItems(collection: string, limit: number) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ items: [] });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: indexedCollection, error: collectionError } = await db.from("nft_collections")
    .select("factory")
    .eq("chain_id", 8453)
    .eq("collection", collection)
    .maybeSingle();
  const currentFactories = new Set([
    nftAddresses.collectionFactory.toLowerCase(),
    nftAddresses.pfpFactory.toLowerCase()
  ]);
  if (collectionError || !indexedCollection || !currentFactories.has(String(indexedCollection.factory).toLowerCase())) {
    return NextResponse.json({ items: [] }, { status: indexedCollection ? 404 : 200 });
  }
  const { data, error } = await db.from("nft_items").select("token_id,max_supply,lifetime_minted,metadata_uri")
    .eq("chain_id", 8453).eq("collection", collection).order("token_id", { ascending: true }).limit(limit);
  if (error) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: data || [] }, { headers: { "cache-control": "public, max-age=5, s-maxage=10, stale-while-revalidate=30" } });
}
