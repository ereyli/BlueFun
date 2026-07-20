import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { formatEther, getAddress, isAddress } from "viem";
import {
  isKnownNFTMarketplace,
  nftAddresses,
  nftDeploymentForFactory
} from "@/lib/nft-contracts";
import {
  readOnchainListingSnapshot,
  type OnchainListingSnapshot,
  type ReconciledNFTListing
} from "@/lib/server/nft-onchain-listings";

type IndexedListing = {
  marketplace: unknown;
  listing_id: unknown;
  token_id: unknown;
  unit_price: unknown;
  remaining_quantity: unknown;
  updated_at: unknown;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectionValue = url.searchParams.get("collection") || "";
  const tokenValue = url.searchParams.get("tokenId") || "";
  const requestedLimit = Number(url.searchParams.get("limit") || "500");
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(2000, Math.max(1, requestedLimit)) : 500;
  if (!isAddress(collectionValue)) return NextResponse.json({ error: "Invalid collection address." }, { status: 400 });
  if (tokenValue && (!/^\d+$/.test(tokenValue) || BigInt(tokenValue) < 1n)) return NextResponse.json({ error: "Invalid NFT identifier." }, { status: 400 });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.json(tokenValue ? {} : { listings: [] }, { headers: fastPublicCache() });

  const collectionAddress = getAddress(collectionValue);
  const collection = collectionAddress.toLowerCase();
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const now = Math.floor(Date.now() / 1000);
  let listingQuery = db.from("nft_listings")
    .select("marketplace,listing_id,token_id,unit_price,remaining_quantity,updated_at")
    .eq("chain_id", 8453).eq("collection", collection).eq("cancelled", false)
    .gt("remaining_quantity", 0).lte("start_time", now).gt("end_time", now)
    .order("unit_price", { ascending: true }).limit(limit);
  if (tokenValue) listingQuery = listingQuery.eq("token_id", tokenValue);

  const [indexedResponse, collectionResponse] = await Promise.all([
    listingQuery,
    db.from("nft_collections").select("standard,factory").eq("chain_id", 8453).eq("collection", collection).maybeSingle()
  ]);

  const indexed = indexedResponse.error ? [] : normalizeIndexedListings((indexedResponse.data || []) as IndexedListing[]);
  let snapshot: OnchainListingSnapshot | undefined;
  const collectionRow = collectionResponse.data;
  const currentFactories = new Set([
    nftAddresses.collectionFactory.toLowerCase(),
    nftAddresses.pfpFactory.toLowerCase()
  ]);
  const isCurrentCollection = collectionRow && currentFactories.has(String(collectionRow.factory).toLowerCase());
  if (!isCurrentCollection) {
    return NextResponse.json(tokenValue ? {} : { listings: [] }, { status: collectionRow ? 404 : 200, headers: fastPublicCache() });
  }
  if (collectionRow.standard === "ERC721" || collectionRow.standard === "ERC1155") {
    snapshot = await readOnchainListingSnapshot({
      collection: collectionAddress,
      standard: collectionRow.standard,
      deployment: nftDeploymentForFactory(String(collectionRow.factory || ""))
    }).catch(() => undefined);
  }

  const listings = reconcileListings(indexed, snapshot)
    .filter((listing) => !tokenValue || listing.tokenId === tokenValue)
    .sort((a, b) => compareWei(a.unitPrice, b.unitPrice))
    .slice(0, limit);

  if (tokenValue) {
    const listing = listings[0];
    return NextResponse.json(listing ? {
      listingId: listing.listingId,
      marketplace: listing.marketplace,
      unitPrice: listing.unitPrice,
      priceEth: listing.priceEth,
      remaining: listing.remaining,
      standard: listing.standard
    } : {}, { headers: fastPublicCache() });
  }
  return NextResponse.json({ listings }, { headers: fastPublicCache() });
}

function normalizeIndexedListings(rows: IndexedListing[]): ReconciledNFTListing[] {
  return rows.flatMap((row) => {
    try {
      const indexedId = BigInt(String(row.listing_id));
      const standard = indexedId < 0n ? "ERC721" as const : "ERC1155" as const;
      if (!isKnownNFTMarketplace(String(row.marketplace), standard)) return [];
      const unitPrice = String(row.unit_price);
      return [{
        marketplace: String(row.marketplace),
        listingId: String(indexedId < 0n ? -indexedId : indexedId),
        tokenId: String(row.token_id),
        unitPrice,
        priceEth: displayEther(unitPrice),
        remaining: String(row.remaining_quantity),
        standard,
        listedAt: String(row.updated_at || "")
      }];
    } catch {
      return [];
    }
  });
}

function reconcileListings(indexed: ReconciledNFTListing[], snapshot?: OnchainListingSnapshot) {
  if (!snapshot) return indexed;
  const marketplace = snapshot.marketplace.toLowerCase();
  const activeKeys = new Set(snapshot.listings.map(listingKey));
  const merged = new Map<string, ReconciledNFTListing>();

  for (const listing of indexed) {
    const listingId = BigInt(listing.listingId);
    const wasAuthoritativelyScanned = listing.marketplace.toLowerCase() === marketplace
      && listingId >= snapshot.scannedFrom && listingId <= snapshot.scannedTo;
    if (wasAuthoritativelyScanned && !activeKeys.has(listingKey(listing))) continue;
    merged.set(listingKey(listing), listing);
  }
  for (const listing of snapshot.listings) merged.set(listingKey(listing), listing);
  return [...merged.values()];
}

function listingKey(listing: ReconciledNFTListing) {
  return `${listing.marketplace.toLowerCase()}:${listing.listingId}`;
}

function compareWei(left: string, right: string) {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a === b ? 0 : a < b ? -1 : 1;
  } catch {
    return 0;
  }
}

function fastPublicCache() {
  return { "cache-control": "public, max-age=1, s-maxage=2, stale-while-revalidate=10" };
}

function displayEther(value: unknown) {
  try { return formatEther(BigInt(String(value))); }
  catch { return formatEther(BigInt(Math.trunc(Number(value)))); }
}
