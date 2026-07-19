import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { formatEther, getAddress, isAddress } from "viem";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectionValue = url.searchParams.get("collection") || "";
  const tokenValue = url.searchParams.get("tokenId") || "";
  if (!isAddress(collectionValue)) return NextResponse.json({ error: "Invalid collection address." }, { status: 400 });
  if (tokenValue && (!/^\d+$/.test(tokenValue) || BigInt(tokenValue) < 1n)) return NextResponse.json({ error: "Invalid NFT identifier." }, { status: 400 });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.json({}, { headers: { "cache-control": "public, max-age=5" } });
  const collection = getAddress(collectionValue).toLowerCase();
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  if (!tokenValue) {
    const { data, error } = await db.from("nft_listings").select("marketplace,listing_id,token_id,unit_price,remaining_quantity,end_time,updated_at")
      .eq("chain_id", 8453).eq("collection", collection).eq("cancelled", false)
      .gt("remaining_quantity", 0).gt("end_time", Math.floor(Date.now() / 1000)).order("unit_price", { ascending: true }).limit(10000);
    if (error) return NextResponse.json({ listings: [] }, { headers: { "cache-control": "public, max-age=5" } });
    return NextResponse.json({ listings: (data || []).map((row) => ({
      marketplace: row.marketplace, listingId: String(Math.abs(Number(row.listing_id))), tokenId: String(row.token_id), priceEth: displayEther(row.unit_price), remaining: String(row.remaining_quantity), standard: Number(row.listing_id) < 0 ? "ERC721" : "ERC1155", listedAt: String(row.updated_at || "")
    })) }, { headers: { "cache-control": "public, max-age=5, stale-while-revalidate=15" } });
  }
  const { data, error } = await db.from("nft_listings").select("marketplace,listing_id,unit_price,remaining_quantity,end_time")
    .eq("chain_id", 8453).eq("collection", collection).eq("token_id", tokenValue).eq("cancelled", false)
    .gt("remaining_quantity", 0).gt("end_time", Math.floor(Date.now() / 1000)).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return NextResponse.json({}, { headers: { "cache-control": "public, max-age=5" } });
  const indexedId = BigInt(String(data.listing_id));
  const pfp = indexedId < 0n;
  return NextResponse.json({
    listingId: (pfp ? -indexedId : indexedId).toString(),
    marketplace: data.marketplace,
    priceEth: displayEther(data.unit_price),
    remaining: String(data.remaining_quantity),
    standard: pfp ? "ERC721" : "ERC1155"
  }, { headers: { "cache-control": "public, max-age=5, stale-while-revalidate=15" } });
}

function displayEther(value: unknown) {
  try { return formatEther(BigInt(String(value))); }
  catch { return formatEther(BigInt(Math.trunc(Number(value)))); }
}
