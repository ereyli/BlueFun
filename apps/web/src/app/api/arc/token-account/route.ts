import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { arcChain } from "@/lib/arc-chain";
import {
  arcUniswapV3Addresses,
  b20TokenAbi
} from "@/lib/contracts";
import { arcRpcUrls } from "@/lib/rpc";

export const dynamic = "force-dynamic";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const account = request.nextUrl.searchParams.get("account");
  if (
    !token
    || !account
    || !ADDRESS_PATTERN.test(token)
    || !ADDRESS_PATTERN.test(account)
  ) {
    return NextResponse.json({ error: "Invalid token account request." }, { status: 400 });
  }

  for (const rpcUrl of arcRpcUrls()) {
    try {
      const client = createPublicClient({
        chain: arcChain,
        transport: http(rpcUrl, { retryCount: 0, timeout: 6_000 })
      });
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: token as `0x${string}`,
          abi: b20TokenAbi,
          functionName: "balanceOf",
          args: [account as `0x${string}`]
        }),
        client.readContract({
          address: token as `0x${string}`,
          abi: b20TokenAbi,
          functionName: "allowance",
          args: [
            account as `0x${string}`,
            arcUniswapV3Addresses.swapRouter
          ]
        })
      ]);

      return NextResponse.json(
        {
          balance: balance.toString(),
          allowance: allowance.toString()
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      // Try the next independently configured Arc RPC.
    }
  }

  return NextResponse.json(
    { error: "Arc token balance is temporarily unavailable." },
    { status: 503 }
  );
}
