import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, fallback, formatEther, getAddress, hashTypedData, http, isAddress, verifyTypedData, zeroAddress, type Hex } from "viem";
import { getNFTCollections } from "@/lib/nft-collections";
import { nftAddresses, nftCollectionFactoryAbi, nftOffersEnabled, nftPFPFactoryAbi } from "@/lib/nft-contracts";
import { baseChain } from "@/lib/base-chain";
import { baseRpcUrls } from "@/lib/rpc";
import { nftOfferDomainFor, nftOfferTypes, parseIndexedNFTOffer, type NFTOffer } from "@/lib/nft-offers";
import { assertRateLimit, assertRequestSize, assertSameOrigin, RequestGuardError } from "@/lib/server/request-guard";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectionValue = url.searchParams.get("collection") || "";
  const makerValue = url.searchParams.get("maker") || "";
  const ownerValue = url.searchParams.get("owner") || "";
  const tokenValue = url.searchParams.get("tokenId") || "";
  if (collectionValue && !isAddress(collectionValue)) return NextResponse.json({ error: "Invalid collection." }, { status: 400 });
  if (makerValue && !isAddress(makerValue)) return NextResponse.json({ error: "Invalid maker." }, { status: 400 });
  if (ownerValue && !isAddress(ownerValue)) return NextResponse.json({ error: "Invalid owner." }, { status: 400 });
  if (tokenValue && !/^\d+$/.test(tokenValue)) return NextResponse.json({ error: "Invalid token ID." }, { status: 400 });
  const db = publicDatabase();
  if (!db) return NextResponse.json({ offers: [], enabled: nftOffersEnabled });
  let owned = new Map<string, Set<string>>();
  if (ownerValue) {
    const { data: balances, error: balanceError } = await db.from("nft_balances").select("collection,token_id,balance").eq("chain_id", 8453).eq("owner", getAddress(ownerValue).toLowerCase()).gt("balance", 0).limit(2000);
    if (balanceError || !balances?.length) return NextResponse.json({ offers: [], enabled: nftOffersEnabled });
    owned = new Map<string, Set<string>>();
    for (const balance of balances) {
      const collection = String(balance.collection).toLowerCase();
      if (!owned.has(collection)) owned.set(collection, new Set());
      owned.get(collection)!.add(String(balance.token_id));
    }
  }
  let query = db.from("nft_offers").select("*").eq("chain_id", 8453)
    .eq("offers_contract", nftAddresses.offers.toLowerCase()).eq("cancelled", false)
    .lte("start_time", Math.floor(Date.now() / 1000)).gt("end_time", Math.floor(Date.now() / 1000)).order("unit_price", { ascending: false }).limit(200);
  if (collectionValue) query = query.eq("collection", getAddress(collectionValue).toLowerCase());
  if (makerValue) query = query.eq("maker", getAddress(makerValue).toLowerCase());
  if (ownerValue) query = query.in("collection", [...owned.keys()]);
  if (tokenValue) query = query.or(`and(offer_type.eq.0,token_id.eq.${tokenValue}),offer_type.eq.1`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ offers: [], enabled: nftOffersEnabled });
  const offers = (data || []).map((row) => parseIndexedNFTOffer(row)).filter((offer) => offer.remainingQuantity > 0n && (!ownerValue || (offer.offerType === 1 ? owned.has(offer.collection.toLowerCase()) : owned.get(offer.collection.toLowerCase())?.has(offer.tokenId.toString())))).map((offer) => ({
    ...Object.fromEntries(Object.entries(offer).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])),
    priceWeth: formatEther(offer.unitPrice),
    ownedTokenId: ownerValue ? (offer.offerType === 1 ? [...(owned.get(offer.collection.toLowerCase()) || [])][0] : offer.tokenId.toString()) : undefined
  }));
  return NextResponse.json({ offers, enabled: nftOffersEnabled }, { headers: { "cache-control": "public, max-age=5, stale-while-revalidate=15" } });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRequestSize(request, 16_384);
    await assertRateLimit(request, "nft-offer-create");
    if (!nftOffersEnabled) return NextResponse.json({ error: "NFT offers are not deployed yet." }, { status: 503 });
    const db = privateDatabase();
    if (!db) return NextResponse.json({ error: "Offer storage is unavailable." }, { status: 503 });
    const body = await request.json() as { offer?: Record<string, unknown>; signature?: string; offersContract?: string };
    const offer = parseOffer(body.offer);
    const offersContract = parseOffersContract(body.offersContract);
    const signature = body.signature;
    if (!signature || !/^0x(?:[a-fA-F0-9]{2}){1,2048}$/.test(signature)) throw new RequestGuardError("Invalid offer signature.", 400);
    validateOffer(offer);
    const collections = await getNFTCollections();
    const collection = collections.find((item) => item.address.toLowerCase() === offer.collection.toLowerCase());
    if (!collection) throw new RequestGuardError("Only verified BlueFun collections can receive offers.", 400);
    const expectedStandard = collection.standard === "ERC-721 PFP" ? 1 : 2;
    if (offer.standard !== expectedStandard) throw new RequestGuardError("Collection standard mismatch.", 400);
    if (!(await collectionBelongsToCurrentDeployment(offer.collection, expectedStandard))) throw new RequestGuardError("Collection is not part of the current deployment.", 400);
    const valid = await verifyOfferSignature(offer, signature as Hex, offersContract);
    if (!valid) throw new RequestGuardError("The wallet signature does not match this offer.", 400);
    const domain = nftOfferDomainFor(offersContract);
    const offerHash = hashTypedData({ domain, types: nftOfferTypes, primaryType: "Offer", message: offer }).toLowerCase();
    const { data: nonceFloor } = await db.from("nft_offer_nonce_floors").select("minimum_nonce").eq("chain_id", 8453).eq("offers_contract", offersContract.toLowerCase()).eq("maker", offer.maker.toLowerCase()).maybeSingle();
    if (nonceFloor && offer.nonce < BigInt(String(nonceFloor.minimum_nonce))) throw new RequestGuardError("This offer nonce was already invalidated onchain.", 400);
    const row = {
      chain_id: 8453, offers_contract: offersContract.toLowerCase(), offer_hash: offerHash, maker: offer.maker.toLowerCase(), taker: offer.taker.toLowerCase(),
      recipient: offer.recipient.toLowerCase(), collection: offer.collection.toLowerCase(), token_id: offer.tokenId.toString(),
      unit_price: offer.unitPrice.toString(), quantity: offer.quantity.toString(), filled_quantity: "0",
      start_time: offer.startTime.toString(), end_time: offer.endTime.toString(), nonce: offer.nonce.toString(),
      standard: offer.standard, offer_type: offer.offerType, signature: signature.toLowerCase(), cancelled: false,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from("nft_offers").upsert(row, { onConflict: "chain_id,offer_hash", ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ offerHash }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestGuardError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("NFT offer creation failed", error);
    return NextResponse.json({ error: "Offer could not be saved." }, { status: 500 });
  }
}

const offerPublicClient = createPublicClient({ chain: baseChain, transport: fallback(baseRpcUrls().map((url) => http(url, { timeout: 7_000, retryCount: 0 })), { rank: true, retryCount: 0 }) });
const eip1271Abi = [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }], outputs: [{ name: "magicValue", type: "bytes4" }] }] as const;

async function verifyOfferSignature(offer: NFTOffer, signature: Hex, offersContract: `0x${string}`) {
  try {
    const domain = nftOfferDomainFor(offersContract);
    const digest = hashTypedData({ domain, types: nftOfferTypes, primaryType: "Offer", message: offer });
    const code = await offerPublicClient.getBytecode({ address: offer.maker });
    if (code && code !== "0x") {
      return await offerPublicClient.readContract({ address: offer.maker, abi: eip1271Abi, functionName: "isValidSignature", args: [digest, signature] }) === "0x1626ba7e";
    }
    return await verifyTypedData({ address: offer.maker, domain, types: nftOfferTypes, primaryType: "Offer", message: offer, signature });
  } catch {
    return false;
  }
}

function parseOffersContract(value?: string) {
  if (!value || !isAddress(value)) throw new RequestGuardError("Offer contract is required.", 400);
  const contract = getAddress(value);
  if (nftAddresses.offers.toLowerCase() !== contract.toLowerCase()) {
    throw new RequestGuardError("Unsupported offer contract.", 400);
  }
  return contract;
}

async function collectionBelongsToCurrentDeployment(collection: `0x${string}`, standard: number) {
  const factory = standard === 1
    ? nftAddresses.pfpFactory
    : nftAddresses.collectionFactory;
  const abi = standard === 1 ? nftPFPFactoryAbi : nftCollectionFactoryAbi;
  try { return await offerPublicClient.readContract({ address: factory, abi, functionName: "isBlueFunCollection", args: [collection] }); }
  catch { return false; }
}

function parseOffer(value?: Record<string, unknown>): NFTOffer {
  if (!value) throw new RequestGuardError("Offer is required.", 400);
  try {
    return {
      maker: getAddress(String(value.maker)), taker: getAddress(String(value.taker)), recipient: getAddress(String(value.recipient)),
      collection: getAddress(String(value.collection)), tokenId: BigInt(String(value.tokenId)), unitPrice: BigInt(String(value.unitPrice)),
      quantity: BigInt(String(value.quantity)), startTime: BigInt(String(value.startTime)), endTime: BigInt(String(value.endTime)),
      nonce: BigInt(String(value.nonce)), standard: Number(value.standard), offerType: Number(value.offerType)
    };
  } catch { throw new RequestGuardError("Offer fields are invalid.", 400); }
}

function validateOffer(offer: NFTOffer) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (!isAddress(offer.maker) || !isAddress(offer.recipient) || !isAddress(offer.collection) || offer.maker === zeroAddress || offer.recipient === zeroAddress) throw new RequestGuardError("Invalid offer address.", 400);
  if (offer.unitPrice <= 0n || offer.unitPrice > (2n ** 128n - 1n) || offer.quantity <= 0n || offer.quantity > (2n ** 64n - 1n)) throw new RequestGuardError("Invalid offer price or quantity.", 400);
  if (offer.startTime > now + 300n || offer.endTime <= now || offer.endTime - offer.startTime > 180n * 86400n) throw new RequestGuardError("Offer duration must be at most 180 days.", 400);
  if (![1, 2].includes(offer.standard) || ![0, 1].includes(offer.offerType)) throw new RequestGuardError("Invalid offer type.", 400);
  if (offer.offerType === 0 && offer.standard === 1 && offer.quantity !== 1n) throw new RequestGuardError("ERC-721 item offers have quantity one.", 400);
  if (offer.offerType === 1 && offer.tokenId !== 0n) throw new RequestGuardError("Collection offers cannot target a token ID.", 400);
}

function publicDatabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : undefined;
}
function privateDatabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : undefined;
}
