import type { Address, Hex } from "viem";
import { nftAddresses } from "./nft-contracts";

export type NFTOffer = {
  maker: Address;
  taker: Address;
  recipient: Address;
  collection: Address;
  tokenId: bigint;
  unitPrice: bigint;
  quantity: bigint;
  startTime: bigint;
  endTime: bigint;
  nonce: bigint;
  standard: number;
  offerType: number;
};

export type IndexedNFTOffer = NFTOffer & {
  offersContract: Address;
  offerHash: Hex;
  signature: Hex;
  filledQuantity: bigint;
  remainingQuantity: bigint;
  cancelled: boolean;
  createdAt: string;
};

export function nftOfferDomainFor(verifyingContract: Address) { return {
  name: "BlueFun NFT Offers",
  version: "1",
  chainId: 8453,
  verifyingContract
} as const; }

export const nftOfferDomain = nftOfferDomainFor(nftAddresses.offers);

export const nftOfferTypes = {
  Offer: [
    { name: "maker", type: "address" }, { name: "taker", type: "address" },
    { name: "recipient", type: "address" }, { name: "collection", type: "address" },
    { name: "tokenId", type: "uint256" }, { name: "unitPrice", type: "uint128" },
    { name: "quantity", type: "uint64" }, { name: "startTime", type: "uint64" },
    { name: "endTime", type: "uint64" }, { name: "nonce", type: "uint256" },
    { name: "standard", type: "uint8" }, { name: "offerType", type: "uint8" }
  ]
} as const;

export function serializeNFTOffer(offer: NFTOffer) {
  return Object.fromEntries(Object.entries(offer).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]));
}

export function parseIndexedNFTOffer(row: Record<string, unknown>): IndexedNFTOffer {
  const quantity = BigInt(String(row.quantity));
  const filledQuantity = BigInt(String(row.filled_quantity || 0));
  return {
    offersContract: String(row.offers_contract || nftAddresses.offers) as Address,
    offerHash: String(row.offer_hash) as Hex,
    maker: String(row.maker) as Address,
    taker: String(row.taker) as Address,
    recipient: String(row.recipient) as Address,
    collection: String(row.collection) as Address,
    tokenId: BigInt(String(row.token_id)),
    unitPrice: BigInt(String(row.unit_price)),
    quantity,
    filledQuantity,
    remainingQuantity: quantity > filledQuantity ? quantity - filledQuantity : 0n,
    startTime: BigInt(String(row.start_time)),
    endTime: BigInt(String(row.end_time)),
    nonce: BigInt(String(row.nonce)),
    standard: Number(row.standard),
    offerType: Number(row.offer_type),
    signature: String(row.signature) as Hex,
    cancelled: Boolean(row.cancelled),
    createdAt: String(row.created_at)
  };
}
