import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "viem";

export async function GET(request: Request) {
  const walletValue = new URL(request.url).searchParams.get("wallet") || "";
  if (!isAddress(walletValue)) return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.json({ created: [], owned: [], listings: [], activity: [], indexingReady: false });

  const wallet = getAddress(walletValue).toLowerCase();
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const [createdResult, balancesResult, listingsResult, mintsResult, transfersResult] = await Promise.all([
    db.from("nft_collections").select("collection,factory,name,symbol,standard,initial_max_supply,created_at").eq("chain_id", 8453).eq("creator", wallet).order("created_at", { ascending: false }),
    db.from("nft_balances").select("collection,token_id,balance,updated_at").eq("chain_id", 8453).eq("owner", wallet).gt("balance", 0).order("updated_at", { ascending: false }),
    db.from("nft_listings").select("listing_id,collection,token_id,remaining_quantity,unit_price,end_time,cancelled,updated_at").eq("chain_id", 8453).eq("seller", wallet).order("updated_at", { ascending: false }).limit(100),
    db.from("nft_mints").select("collection,token_id,quantity,gross_amount,tx_hash,created_at").eq("chain_id", 8453).or(`payer.eq.${wallet},recipient.eq.${wallet}`).order("created_at", { ascending: false }).limit(50),
    db.from("nft_transfers").select("collection,token_id,from_wallet,to_wallet,quantity,tx_hash,created_at").eq("chain_id", 8453).or(`from_wallet.eq.${wallet},to_wallet.eq.${wallet}`).order("created_at", { ascending: false }).limit(50)
  ]);

  const indexingReady = !balancesResult.error;
  const collections = new Set<string>();
  for (const row of balancesResult.data || []) collections.add(String(row.collection));
  for (const row of listingsResult.data || []) collections.add(String(row.collection));
  const collectionResult = collections.size
    ? await db.from("nft_collections").select("collection,factory,name,symbol,standard").eq("chain_id", 8453).in("collection", [...collections])
    : { data: [], error: null };
  const itemResult = collections.size
    ? await db.from("nft_items").select("collection,token_id,metadata_uri").eq("chain_id", 8453).in("collection", [...collections]).limit(10000)
    : { data: [], error: null };
  const names = new Map((collectionResult.data || []).map((row) => [String(row.collection).toLowerCase(), row]));
  const itemMetadata = new Map((itemResult.data || []).map((row) => [`${String(row.collection).toLowerCase()}:${String(row.token_id)}`, String(row.metadata_uri || "")]));

  return NextResponse.json({
    created: createdResult.data || [],
    owned: (balancesResult.data || []).map((row) => ({ ...row, metadataUri: itemMetadata.get(`${String(row.collection).toLowerCase()}:${String(row.token_id)}`) || "", collectionInfo: names.get(String(row.collection).toLowerCase()) || null })),
    listings: (listingsResult.data || []).map((row) => ({ ...row, collectionInfo: names.get(String(row.collection).toLowerCase()) || null })),
    activity: [
      ...(mintsResult.data || []).map((row) => ({ ...row, type: "mint", counterparty: null })),
      ...(transfersResult.data || []).filter((row) => row.from_wallet !== "0x0000000000000000000000000000000000000000").map((row) => ({ ...row, type: row.to_wallet === wallet ? "received" : "sent", counterparty: row.to_wallet === wallet ? row.from_wallet : row.to_wallet }))
    ].sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime()).slice(0, 100),
    indexingReady,
    errors: [createdResult.error?.message, balancesResult.error?.message, listingsResult.error?.message, mintsResult.error?.message, transfersResult.error?.message, itemResult.error?.message].filter(Boolean)
  }, { headers: { "cache-control": "private, no-store" } });
}
