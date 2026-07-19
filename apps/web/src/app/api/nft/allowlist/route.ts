import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, fallback, getAddress, http, isAddress } from "viem";
import { baseChain } from "@/lib/base-chain";
import { baseRpcUrls } from "@/lib/rpc";
import { buildAllowlistTree, type AllowlistInput } from "@/lib/nft-allowlist";
import { nftAddresses, nftDropControllerAbi } from "@/lib/nft-contracts";
import { assertRateLimit, assertRequestSize, assertSameOrigin, RequestGuardError } from "@/lib/server/request-guard";

const client = createPublicClient({ chain: baseChain, transport: fallback(baseRpcUrls().map((url) => http(url, { timeout: 8_000, retryCount: 0 })), { rank: true }) });

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const collection = query.get("collection") || ""; const wallet = query.get("wallet") || "";
  const tokenId = query.get("tokenId") || ""; const phaseId = query.get("phaseId") || "";
  if (!isAddress(collection) || !isAddress(wallet) || !/^\d+$/.test(tokenId) || !/^\d+$/.test(phaseId)) return NextResponse.json({ error: "Invalid allowlist lookup." }, { status: 400 });
  const db = database(); if (!db) return NextResponse.json({ entry: null }, { status: 503 });
  const { data, error } = await db.from("nft_allowlist_entries").select("allowance,unit_price,merkle_root,proof")
    .eq("chain_id", 8453).eq("collection", getAddress(collection).toLowerCase()).eq("token_id", tokenId).eq("phase_id", phaseId).eq("wallet", getAddress(wallet).toLowerCase()).maybeSingle();
  if (error) return NextResponse.json({ entry: null }, { status: 503 });
  return NextResponse.json({ entry: data ? { allowance: String(data.allowance), unitPrice: String(data.unit_price), root: data.merkle_root, proof: data.proof } : null }, { headers: { "cache-control": "private, max-age=15" } });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); assertRequestSize(request, 12_000_000); await assertRateLimit(request, "nft-allowlist-save");
    const body = await request.json() as { collection?: string; tokenId?: string; phaseId?: string; root?: string; entries?: Array<{ wallet?: string; allowance?: string; unitPrice?: string; proof?: string[] }> };
    if (!body.collection || !isAddress(body.collection) || !/^\d+$/.test(body.tokenId || "") || !/^\d+$/.test(body.phaseId || "") || !/^0x[a-fA-F0-9]{64}$/.test(body.root || "")) throw new RequestGuardError("Invalid allowlist manifest.", 400);
    if (!body.entries?.length || body.entries.length > 10_000) throw new RequestGuardError("Allowlist must contain 1–10,000 wallets.", 400);
    const collection = getAddress(body.collection); const tokenId = BigInt(body.tokenId!); const phaseId = BigInt(body.phaseId!);
    const inputs: AllowlistInput[] = body.entries.map((entry) => {
      if (!entry.wallet || !isAddress(entry.wallet) || !/^\d+$/.test(entry.allowance || "") || !/^\d+$/.test(entry.unitPrice || "")) throw new RequestGuardError("Invalid allowlist entry.", 400);
      return { wallet: getAddress(entry.wallet), allowance: BigInt(entry.allowance!), unitPrice: BigInt(entry.unitPrice!) };
    });
    const tree = buildAllowlistTree(inputs, collection, tokenId, phaseId);
    if (tree.root.toLowerCase() !== body.root!.toLowerCase()) throw new RequestGuardError("Allowlist root does not match the entries.", 400);
    const phase = await client.readContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "phases", args: [collection, tokenId, phaseId] });
    if (phase[9].toLowerCase() !== tree.root.toLowerCase() || phase[11]) throw new RequestGuardError("Allowlist root is not active onchain.", 400);
    const db = database(); if (!db) return NextResponse.json({ error: "Allowlist storage is unavailable." }, { status: 503 });
    const rows = tree.entries.map((entry) => ({ chain_id: 8453, collection: collection.toLowerCase(), token_id: tokenId.toString(), phase_id: phaseId.toString(), wallet: entry.wallet.toLowerCase(), allowance: entry.allowance.toString(), unit_price: entry.unitPrice.toString(), merkle_root: tree.root.toLowerCase(), proof: entry.proof, updated_at: new Date().toISOString() }));
    const { error: deleteError } = await db.from("nft_allowlist_entries").delete().eq("chain_id", 8453).eq("collection", collection.toLowerCase()).eq("token_id", tokenId.toString()).eq("phase_id", phaseId.toString());
    if (deleteError) throw deleteError;
    for (let offset = 0; offset < rows.length; offset += 500) {
      const { error } = await db.from("nft_allowlist_entries").upsert(rows.slice(offset, offset + 500), { onConflict: "chain_id,collection,token_id,phase_id,wallet" });
      if (error) throw error;
    }
    return NextResponse.json({ saved: rows.length }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestGuardError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Allowlist storage failed", error); return NextResponse.json({ error: "Allowlist could not be saved." }, { status: 500 });
  }
}

function database() {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : undefined;
}
