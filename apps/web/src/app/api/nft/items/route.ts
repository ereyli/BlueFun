import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "viem";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("collection") || "";
  if (!isAddress(value)) return NextResponse.json({ error: "Invalid collection address." }, { status: 400 });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ items: [] });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.from("nft_items").select("token_id,max_supply,lifetime_minted,metadata_uri")
    .eq("chain_id", 8453).eq("collection", getAddress(value).toLowerCase()).order("token_id", { ascending: true }).limit(10000);
  if (error) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: data || [] }, { headers: { "cache-control": "public, max-age=10, stale-while-revalidate=30" } });
}
