import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http
} from "viem";
import { arcChain } from "@/lib/arc-chain";
import {
  arcUniswapV3Addresses,
  uniswapV3QuoterAbi
} from "@/lib/contracts";
import { arcRpcUrls } from "@/lib/rpc";

export const dynamic = "force-dynamic";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const UINT256_PATTERN = /^\d{1,78}$/;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const amount = request.nextUrl.searchParams.get("amount");
  const mode = request.nextUrl.searchParams.get("mode");

  if (
    !token
    || !ADDRESS_PATTERN.test(token)
    || !amount
    || !UINT256_PATTERN.test(amount)
    || (mode !== "buy" && mode !== "sell")
  ) {
    return NextResponse.json({ error: "Invalid quote request." }, { status: 400 });
  }

  const amountIn = BigInt(amount);
  if (amountIn === 0n || amountIn >= 1n << 256n) {
    return NextResponse.json({ error: "Invalid quote amount." }, { status: 400 });
  }

  const quoteToken = arcUniswapV3Addresses.quoteToken;
  const tokenAddress = token as `0x${string}`;
  const callData = encodeFunctionData({
    abi: uniswapV3QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      tokenIn: mode === "buy" ? quoteToken : tokenAddress,
      tokenOut: mode === "buy" ? tokenAddress : quoteToken,
      amountIn,
      fee: 10_000,
      sqrtPriceLimitX96: 0n
    }]
  });

  for (const rpcUrl of arcRpcUrls()) {
    try {
      const client = createPublicClient({
        chain: arcChain,
        transport: http(rpcUrl, { retryCount: 0, timeout: 6_000 })
      });
      const response = await client.call({
        to: arcUniswapV3Addresses.quoter,
        data: callData
      });
      if (!response.data) continue;

      const [amountOut] = decodeFunctionResult({
        abi: uniswapV3QuoterAbi,
        functionName: "quoteExactInputSingle",
        data: response.data
      });
      if (amountOut > 0n) {
        return NextResponse.json(
          { amountOut: amountOut.toString() },
          { headers: { "Cache-Control": "public, max-age=1, stale-while-revalidate=3" } }
        );
      }
    } catch {
      // Try the next independently configured Arc RPC.
    }
  }

  return NextResponse.json(
    { error: "Arc price quote is temporarily unavailable." },
    { status: 503 }
  );
}
