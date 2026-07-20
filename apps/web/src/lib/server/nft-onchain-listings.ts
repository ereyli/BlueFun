import "server-only";

import { createPublicClient, fallback, formatEther, getAddress, http, type Address } from "viem";
import { baseChain } from "@/lib/base-chain";
import {
  nftMarketplaceAbi,
  nftMarketplaceForDeployment,
  nftPFPMarketplaceAbi,
  type NFTDeployment
} from "@/lib/nft-contracts";
import { baseRpcUrls } from "@/lib/rpc";

const RECONCILE_WINDOW = 256n;
const CACHE_TTL_MS = 4_000;

export type ReconciledNFTListing = {
  marketplace: string;
  listingId: string;
  tokenId: string;
  unitPrice: string;
  priceEth: string;
  remaining: string;
  standard: "ERC721" | "ERC1155";
  listedAt: string;
};

export type OnchainListingSnapshot = {
  listings: ReconciledNFTListing[];
  marketplace: string;
  scannedFrom: bigint;
  scannedTo: bigint;
};

type CacheEntry = { expiresAt: number; value: Promise<OnchainListingSnapshot> };
const snapshotCache = new Map<string, CacheEntry>();

const client = createPublicClient({
  chain: baseChain,
  transport: fallback(baseRpcUrls().map((url) => http(url, { timeout: 5_000 })), { rank: true })
});

export function readOnchainListingSnapshot(input: {
  collection: Address;
  standard: "ERC721" | "ERC1155";
  deployment: NFTDeployment;
}) {
  const marketplace = getAddress(nftMarketplaceForDeployment(input.deployment, input.standard));
  const key = `${marketplace.toLowerCase()}:${input.collection.toLowerCase()}`;
  const now = Date.now();
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = loadSnapshot({ ...input, marketplace }).catch((error) => {
    snapshotCache.delete(key);
    throw error;
  });
  snapshotCache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

async function loadSnapshot(input: {
  collection: Address;
  marketplace: Address;
  standard: "ERC721" | "ERC1155";
  deployment: NFTDeployment;
}): Promise<OnchainListingSnapshot> {
  const abi = input.standard === "ERC721" ? nftPFPMarketplaceAbi : nftMarketplaceAbi;
  const listingCount = await client.readContract({ address: input.marketplace, abi, functionName: "listingCount" });
  const scannedFrom = listingCount > RECONCILE_WINDOW ? listingCount - RECONCILE_WINDOW + 1n : 1n;
  if (listingCount === 0n) return { listings: [], marketplace: input.marketplace, scannedFrom: 1n, scannedTo: 0n };

  const contracts = Array.from({ length: Number(listingCount - scannedFrom + 1n) }, (_, index) => ({
    address: input.marketplace,
    abi,
    functionName: "listings" as const,
    args: [scannedFrom + BigInt(index)] as const
  }));
  const results = await client.multicall({ contracts, allowFailure: true });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const listings: ReconciledNFTListing[] = [];

  results.forEach((result, index) => {
    if (result.status !== "success" || !Array.isArray(result.result)) return;
    const values = result.result as readonly unknown[];
    const listedCollection = String(values[1] || "").toLowerCase();
    if (listedCollection !== input.collection.toLowerCase()) return;

    const listingId = scannedFrom + BigInt(index);
    const tokenId = BigInt(String(values[2]));
    const unitPrice = BigInt(String(values[3]));
    const startTime = BigInt(String(values[4]));
    const endTime = BigInt(String(values[5]));
    const remaining = input.standard === "ERC721" ? 1n : BigInt(String(values[6]));
    const cancelled = Boolean(values[input.standard === "ERC721" ? 6 : 7]);
    const sold = input.standard === "ERC721" ? Boolean(values[7]) : false;
    if (cancelled || sold || remaining === 0n || startTime > now || endTime <= now) return;

    listings.push({
      marketplace: input.marketplace,
      listingId: listingId.toString(),
      tokenId: tokenId.toString(),
      unitPrice: unitPrice.toString(),
      priceEth: formatEther(unitPrice),
      remaining: remaining.toString(),
      standard: input.standard,
      listedAt: ""
    });
  });

  return { listings, marketplace: input.marketplace, scannedFrom, scannedTo: listingCount };
}
