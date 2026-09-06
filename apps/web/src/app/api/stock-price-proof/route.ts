import { NextRequest, NextResponse } from "next/server";
import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getRobinhoodStockAssets } from "@/lib/stock-assets";

export const runtime = "nodejs";

type PriceResponse = {
  quotes?: Array<{ tokenSymbol?: string; bid?: string; ask?: string; isTradingHalt?: boolean }>;
};
type AssetResponse = {
  assets?: Array<{ tokenSymbol?: string; currentMultiplier?: string }>;
};

function decimalToWad(value: string) {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) throw new Error("Invalid price");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0").slice(0, 18));
}

export async function GET(request: NextRequest) {
  const chainId = Number(request.nextUrl.searchParams.get("chainId"));
  const token = request.nextUrl.searchParams.get("token")?.toLowerCase();
  if (chainId !== 4663 || !token || !/^0x[a-f0-9]{40}$/.test(token)) {
    return NextResponse.json({ error: "Invalid Robinhood stock token." }, { status: 400 });
  }
  const privateKey = process.env.STOCK_PRICE_SIGNER_PRIVATE_KEY;
  const registry = process.env.NEXT_PUBLIC_ROBINHOOD_STOCK_QUOTE_REGISTRY;
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey) || !registry || !/^0x[a-fA-F0-9]{40}$/.test(registry)) {
    return NextResponse.json({ error: "Stock price attestation is not configured." }, { status: 503 });
  }
  try {
    const asset = (await getRobinhoodStockAssets()).find((item) => item.token.toLowerCase() === token);
    if (!asset || asset.priceMode !== "attested") {
      return NextResponse.json({ error: "This asset does not require an attested price." }, { status: 400 });
    }
    const [priceResponse, assetResponse] = await Promise.all([
      fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(asset.symbol)}`, { cache: "no-store" }),
      fetch("https://api.robinhood.com/rhj/assets", { next: { revalidate: 60 } })
    ]);
    if (!priceResponse.ok || !assetResponse.ok) throw new Error("Official Robinhood price source is unavailable");
    const prices = (await priceResponse.json()) as PriceResponse;
    const metadata = (await assetResponse.json()) as AssetResponse;
    const quote = prices.quotes?.find((item) => item.tokenSymbol?.toUpperCase() === asset.symbol);
    const multiplier = metadata.assets?.find((item) => item.tokenSymbol?.toUpperCase() === asset.symbol)?.currentMultiplier;
    if (!quote?.bid || !quote.ask || !multiplier || quote.isTradingHalt) throw new Error("Stock price is unavailable");
    const bid = decimalToWad(quote.bid);
    const ask = decimalToWad(quote.ask);
    const multiplierWad = decimalToWad(multiplier);
    const midWad = (bid + ask) / 2n;
    const price18 = midWad * multiplierWad / 10n ** 18n;
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 120);
    const payload = keccak256(encodeAbiParameters(
      parseAbiParameters("string,uint256,address,address,uint256,uint64"),
      ["BLUEFUN_STOCK_OPENING_PRICE_V1", 4663n, registry as `0x${string}`, asset.token, price18, validUntil]
    ));
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const signature = await account.signMessage({ message: { raw: payload } });
    return NextResponse.json({ token: asset.token, price18: price18.toString(), validUntil: validUntil.toString(), signature });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not attest the stock price." },
      { status: 502 }
    );
  }
}
