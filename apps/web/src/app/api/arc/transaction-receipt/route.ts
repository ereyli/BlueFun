import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { arcChain } from "@/lib/arc-chain";
import { arcRpcUrls } from "@/lib/rpc";

export const dynamic = "force-dynamic";

const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("hash");
  if (!hash || !TRANSACTION_HASH_PATTERN.test(hash)) {
    return NextResponse.json({ error: "Invalid transaction hash." }, { status: 400 });
  }

  for (const rpcUrl of arcRpcUrls()) {
    try {
      const client = createPublicClient({
        chain: arcChain,
        transport: http(rpcUrl, { retryCount: 0, timeout: 6_000 })
      });
      const receipt = await client.getTransactionReceipt({
        hash: hash as `0x${string}`
      });
      return NextResponse.json({
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString()
      });
    } catch {
      // A pending receipt or an unavailable endpoint should fall through.
    }
  }

  return NextResponse.json(
    { status: "pending" },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}
