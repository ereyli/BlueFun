import { NextResponse } from "next/server";
import { assertRequestSize, assertSameOrigin, RequestGuardError } from "@/lib/server/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "getAccountInfo", "getBalance", "getBlockTime", "getEpochInfo", "getFeeForMessage",
  "getLatestBlockhash", "getMinimumBalanceForRentExemption", "getMultipleAccounts",
  "getProgramAccounts", "getRecentPrioritizationFees", "getSignatureStatuses",
  "getSignaturesForAddress", "getSlot", "getTokenAccountBalance", "getTokenAccountsByOwner",
  "getTransaction", "isBlockhashValid", "sendTransaction", "simulateTransaction"
]);
const rpcBuckets = new Map<string, { count: number; resetAt: number }>();

type RpcCall = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRequestSize(request, 1_000_000);
    if (!consumeRpcLimit(request)) return NextResponse.json({ error: "Solana RPC rate limit reached. Retry shortly." }, { status: 429 });
    const body = await request.json() as RpcCall | RpcCall[];
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.length || calls.length > 25 || calls.some((call) => !call || typeof call.method !== "string" || !ALLOWED_METHODS.has(call.method))) {
      return NextResponse.json({ error: "Unsupported Solana RPC request." }, { status: 400 });
    }

    const upstream = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    if (upstream.includes("/api/solana/rpc")) {
      return NextResponse.json({ error: "SOLANA_RPC_URL cannot point to the BlueFun RPC proxy." }, { status: 500 });
    }

    const response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" }
    });
  } catch (error) {
    if (error instanceof RequestGuardError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "Solana RPC request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function consumeRpcLimit(request: Request) {
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const current = rpcBuckets.get(ip);
  if (!current || current.resetAt <= now) {
    if (rpcBuckets.size > 5_000) for (const [key, value] of rpcBuckets) if (value.resetAt <= now) rpcBuckets.delete(key);
    rpcBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 600;
}
