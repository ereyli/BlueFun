import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "viem";
import { nftAddresses } from "@/lib/nft-contracts";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("collection") || "";
  if (!isAddress(value)) return NextResponse.json({ error: "Invalid collection address." }, { status: 400 });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const empty = { activity: [], summary: { floorPrice: null, totalVolume: "0", sales: 0, mints: 0, listed: 0, owners: 0 } };
  if (!supabaseUrl || !supabaseKey) return NextResponse.json(empty);
  const collection = getAddress(value).toLowerCase();
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
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
    return NextResponse.json(empty, { status: indexedCollection ? 404 : 200 });
  }
  const now = Math.floor(Date.now() / 1000);
  const [mints, listings, transfers, ownerCount] = await Promise.all([
    db.from("nft_mints").select("token_id,recipient,quantity,gross_amount,tx_hash,log_index,created_at").eq("chain_id", 8453).eq("collection", collection).order("created_at", { ascending: false }).limit(50),
    db.from("nft_listings").select("listing_id,seller,token_id,original_quantity,remaining_quantity,unit_price,end_time,cancelled,created_tx,updated_at").eq("chain_id", 8453).eq("collection", collection).order("updated_at", { ascending: false }).limit(1000),
    db.from("nft_transfers").select("token_id,from_wallet,to_wallet,quantity,tx_hash,log_index,batch_index,created_at").eq("chain_id", 8453).eq("collection", collection).order("created_at", { ascending: false }).limit(50),
    db.rpc("nft_collection_owner_count", { p_chain_id: 8453, p_collection: collection })
  ]);
  const listingRows = listings.data || [];
  const listingIds = listingRows.map((row) => row.listing_id);
  const sales = listingIds.length ? await db.from("nft_sales").select("listing_id,buyer,recipient,quantity,gross_amount,tx_hash,log_index,created_at").eq("chain_id", 8453).in("listing_id", listingIds).order("created_at", { ascending: false }).limit(50) : { data: [], error: null };
  const listingById = new Map(listingRows.map((row) => [String(row.listing_id), row]));
  const activity = [
    ...(mints.data || []).map((row) => ({ id: `mint-${row.tx_hash}-${row.log_index}`, type: "mint", tokenId: String(row.token_id), quantity: String(row.quantity), amount: String(row.gross_amount), wallet: row.recipient, txHash: row.tx_hash, createdAt: row.created_at })),
    ...listingRows.slice(0, 50).map((row) => ({ id: `listing-${row.listing_id}`, type: "listing", tokenId: String(row.token_id), quantity: String(row.original_quantity), amount: String(BigInt(String(row.unit_price)) * BigInt(String(row.original_quantity))), wallet: row.seller, txHash: row.created_tx, createdAt: row.updated_at })),
    ...(sales.data || []).map((row) => { const listing = listingById.get(String(row.listing_id)); return ({ id: `sale-${row.tx_hash}-${row.log_index}`, type: "sale", tokenId: String(listing?.token_id || "0"), quantity: String(row.quantity), amount: String(row.gross_amount), wallet: listing?.seller, counterparty: row.recipient || row.buyer, txHash: row.tx_hash, createdAt: row.created_at }); }),
    ...(transfers.data || []).filter((row) => row.from_wallet !== "0x0000000000000000000000000000000000000000").map((row) => ({ id: `transfer-${row.tx_hash}-${row.log_index}-${row.batch_index}`, type: "transfer", tokenId: String(row.token_id), quantity: String(row.quantity), wallet: row.from_wallet, counterparty: row.to_wallet, txHash: row.tx_hash, createdAt: row.created_at }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 100);
  const activeListings = listingRows.filter((row) => !row.cancelled && BigInt(String(row.remaining_quantity)) > 0n && Number(row.end_time) > now);
  const floorPrice = activeListings.reduce<bigint | null>((floor, row) => { const price = BigInt(String(row.unit_price)); return floor === null || price < floor ? price : floor; }, null);
  const totalVolume = (sales.data || []).reduce((sum, row) => sum + BigInt(String(row.gross_amount)), 0n);
  let owners = ownerCount.error ? 0 : Number(ownerCount.data || 0);
  if (ownerCount.error) {
    const fallback = await db.from("nft_balances").select("owner").eq("chain_id", 8453).eq("collection", collection).gt("balance", 0).limit(5000);
    owners = new Set((fallback.data || []).map((row) => String(row.owner).toLowerCase())).size;
  }
  return NextResponse.json({ activity, summary: { floorPrice: floorPrice?.toString() || null, totalVolume: totalVolume.toString(), sales: sales.data?.length || 0, mints: mints.data?.length || 0, listed: activeListings.length, owners } }, { headers: { "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=30" } });
}
