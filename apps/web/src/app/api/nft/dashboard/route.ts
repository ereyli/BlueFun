import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, fallback, getAddress, http, isAddress } from "viem";
import { baseChain } from "@/lib/base-chain";
import { isKnownNFTMarketplace, nftMarketplaceAbi, nftPFPMarketplaceAbi } from "@/lib/nft-contracts";
import { baseRpcUrls } from "@/lib/rpc";

const dashboardClient = createPublicClient({
  chain: baseChain,
  transport: fallback(baseRpcUrls().map((url) => http(url, { timeout: 5_000, retryCount: 0 })), { rank: true, retryCount: 0 })
});

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
    db.from("nft_listings").select("marketplace,listing_id,collection,token_id,remaining_quantity,unit_price,start_time,end_time,cancelled,updated_at").eq("chain_id", 8453).eq("seller", wallet).order("updated_at", { ascending: false }).limit(100),
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
  const listings = await reconcileListings(listingsResult.data || [], names, wallet);

  return NextResponse.json({
    created: createdResult.data || [],
    owned: (balancesResult.data || []).map((row) => ({ ...row, metadataUri: itemMetadata.get(`${String(row.collection).toLowerCase()}:${String(row.token_id)}`) || "", collectionInfo: names.get(String(row.collection).toLowerCase()) || null })),
    listings,
    activity: [
      ...(mintsResult.data || []).map((row) => ({ ...row, type: "mint", counterparty: null })),
      ...(transfersResult.data || []).filter((row) => row.from_wallet !== "0x0000000000000000000000000000000000000000").map((row) => ({ ...row, type: row.to_wallet === wallet ? "received" : "sent", counterparty: row.to_wallet === wallet ? row.from_wallet : row.to_wallet }))
    ].sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime()).slice(0, 100),
    indexingReady,
    errors: [createdResult.error?.message, balancesResult.error?.message, listingsResult.error?.message, mintsResult.error?.message, transfersResult.error?.message, itemResult.error?.message].filter(Boolean)
  }, { headers: { "cache-control": "private, no-store" } });
}

async function reconcileListings(
  rows: Array<Record<string, unknown>>,
  names: Map<string, Record<string, unknown>>,
  wallet: string
) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const prepared = rows.map((row) => {
    const collectionInfo = names.get(String(row.collection).toLowerCase()) || null;
    const standard = collectionInfo?.standard === "ERC721" || BigInt(String(row.listing_id)) < 0n ? "ERC721" as const : "ERC1155" as const;
    const indexedId = BigInt(String(row.listing_id));
    const listingId = indexedId < 0n ? -indexedId : indexedId;
    const marketplace = String(row.marketplace);
    const indexedActive = !row.cancelled && BigInt(String(row.remaining_quantity)) > 0n
      && BigInt(String(row.start_time)) <= now && BigInt(String(row.end_time)) > now;
    return { row, collectionInfo, standard, listingId, marketplace, indexedActive };
  });
  const readable = prepared.filter((item) => isAddress(item.marketplace) && isKnownNFTMarketplace(item.marketplace, item.standard));
  if (!readable.length) return prepared.map((item) => ({ ...item.row, collectionInfo: item.collectionInfo, standard: item.standard, onchainActive: false }));

  try {
    const results = await dashboardClient.multicall({
      allowFailure: true,
      contracts: readable.map((item) => ({
        address: getAddress(item.marketplace),
        abi: item.standard === "ERC721" ? nftPFPMarketplaceAbi : nftMarketplaceAbi,
        functionName: "listings",
        args: [item.listingId]
      }))
    });
    const state = new Map<string, boolean>();
    results.forEach((result, index) => {
      const item = readable[index];
      if (result.status !== "success" || !Array.isArray(result.result)) return;
      const values = result.result as readonly unknown[];
      const identityMatches = String(values[0]).toLowerCase() === wallet
        && String(values[1]).toLowerCase() === String(item.row.collection).toLowerCase()
        && BigInt(String(values[2])) === BigInt(String(item.row.token_id));
      const withinSchedule = BigInt(String(values[4])) <= now && BigInt(String(values[5])) > now;
      const active = item.standard === "ERC721"
        ? identityMatches && withinSchedule && !Boolean(values[6]) && !Boolean(values[7])
        : identityMatches && withinSchedule && BigInt(String(values[6])) > 0n && !Boolean(values[7]);
      state.set(`${item.marketplace.toLowerCase()}:${item.listingId}`, active);
    });
    return prepared.map((item) => ({
      ...item.row,
      collectionInfo: item.collectionInfo,
      standard: item.standard,
      onchainActive: state.get(`${item.marketplace.toLowerCase()}:${item.listingId}`) ?? item.indexedActive
    }));
  } catch {
    return prepared.map((item) => ({ ...item.row, collectionInfo: item.collectionInfo, standard: item.standard, onchainActive: item.indexedActive }));
  }
}
