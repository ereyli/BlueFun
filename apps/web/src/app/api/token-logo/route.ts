import { NextResponse } from "next/server";
import sharp from "sharp";
import { createPublicClient, fallback, getAddress, http, isAddress } from "viem";
import { baseChain } from "@/lib/base-chain";
import { getDbLaunchByToken } from "@/lib/db-launches";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { baseRpcUrls, robinhoodRpcUrls } from "@/lib/rpc";
import { ipfsToGatewayUrls, readTokenMetadata } from "@/lib/token-metadata";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const contractUriAbi = [{ type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;
const baseClient = createPublicClient({ chain: baseChain, transport: fallback(baseRpcUrls().map((url) => http(url, { timeout: 5_000 }))) });
const robinhoodClient = createPublicClient({ chain: robinhoodChain, transport: fallback(robinhoodRpcUrls().map((url) => http(url, { timeout: 5_000 }))) });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawAddress = params.get("address") || "";
  const chainId = Number(params.get("chainId"));
  if (!isAddress(rawAddress) || (chainId !== 8453 && chainId !== 4663)) {
    return NextResponse.json({ error: "Invalid token logo request." }, { status: 400 });
  }

  const address = getAddress(rawAddress);
  try {
    const imageUrl = await resolveTokenImage(chainId, address);
    if (!imageUrl) throw new Error("No verified image source");
    const input = await fetchImage(imageUrl);
    const output = await sharp(input, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize(192, 192, { fit: "cover", position: "centre" })
      .webp({ quality: 86, effort: 3 })
      .toBuffer();
    return new NextResponse(new Uint8Array(output), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Token logo unavailable." }, {
      status: 404,
      headers: { "cache-control": "public, max-age=900, s-maxage=3600" }
    });
  }
}

async function resolveTokenImage(chainId: number, address: `0x${string}`) {
  const results = await Promise.all([
    blueFunTokenImage(chainId, address),
    onchainTokenImage(chainId, address),
    chainId === 4663 ? robinhoodTokenImage(address) : Promise.resolve(undefined),
    geckoTerminalTokenImage(chainId, address),
    dexScreenerTokenImage(chainId, address),
    chainId === 8453 ? coinGeckoTokenImage(address) : Promise.resolve(undefined),
    blockscoutTokenImage(chainId, address)
  ]);
  const resolved = results.find((image) => image && isSafeImageSource(image));
  if (resolved) return resolved;

  if (chainId === 8453) {
    const trustWallet = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${address}/logo.png`;
    if (await isImage(trustWallet)) return trustWallet;
  }
  return undefined;
}

async function onchainTokenImage(chainId: number, address: `0x${string}`) {
  try {
    const client = chainId === 4663 ? robinhoodClient : baseClient;
    const contractURI = await client.readContract({ address, abi: contractUriAbi, functionName: "contractURI" });
    return (await readTokenMetadata(contractURI)).imageURI;
  } catch {
    return undefined;
  }
}

async function blueFunTokenImage(chainId: number, address: string) {
  try {
    return (await getDbLaunchByToken(address, chainId))?.imageURI;
  } catch {
    return undefined;
  }
}

async function coinGeckoTokenImage(address: string) {
  const metadata = await fetchJson<{ image?: { large?: string; small?: string; thumb?: string } }>(`https://api.coingecko.com/api/v3/coins/base/contract/${address.toLowerCase()}`);
  return metadata?.image?.large || metadata?.image?.small || metadata?.image?.thumb;
}

async function geckoTerminalTokenImage(chainId: number, address: string) {
  const network = chainId === 8453 ? "base" : "robinhood-chain";
  const metadata = await fetchJson<{ data?: { attributes?: { image_url?: string | null } } }>(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address.toLowerCase()}`);
  return metadata?.data?.attributes?.image_url || undefined;
}

async function dexScreenerTokenImage(chainId: number, address: string) {
  const metadata = await fetchJson<{ pairs?: Array<{ chainId?: string; baseToken?: { address?: string }; quoteToken?: { address?: string }; info?: { imageUrl?: string } }> }>(`https://api.dexscreener.com/latest/dex/tokens/${address.toLowerCase()}`);
  const expectedChain = chainId === 8453 ? "base" : "robinhood";
  const pair = metadata?.pairs?.find((item) => item.chainId?.toLowerCase().includes(expectedChain)
    && [item.baseToken?.address, item.quoteToken?.address].some((token) => token?.toLowerCase() === address.toLowerCase()));
  return pair?.info?.imageUrl;
}

async function blockscoutTokenImage(chainId: number, address: string) {
  const blockscout = chainId === 8453 ? "https://base.blockscout.com" : "https://robinhoodchain.blockscout.com";
  const metadata = await fetchJson<{ icon_url?: string | null }>(`${blockscout}/api/v2/tokens/${address}`);
  return metadata?.icon_url || undefined;
}

async function robinhoodTokenImage(address: string) {
  const metadata = await fetchJson<{ results?: Array<{ logoUrl?: string; deployments?: Array<{ chainId?: number; contractAddress?: string }> }>; assets?: Array<{ logoUrl?: string; deployments?: Array<{ chainId?: number; contractAddress?: string }> }> }>("https://api.robinhood.com/rhj/assets");
  const assets = metadata?.results || metadata?.assets || [];
  return assets.find((asset) => asset.deployments?.some((deployment) => deployment.chainId === 4663 && deployment.contractAddress?.toLowerCase() === address.toLowerCase()))?.logoUrl;
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "BlueDEX/1.0" },
      signal: controller.signal,
      next: { revalidate: 86_400 }
    });
    return response.ok ? await response.json() as T : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function isImage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal, cache: "no-store" });
    return response.ok && response.headers.get("content-type")?.startsWith("image/") === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchImage(url: string) {
  const sources = url.startsWith("ipfs://") ? ipfsToGatewayUrls(url) : isSafeImageUrl(url) ? [url] : [];
  if (sources.length === 0) throw new Error("Unsafe image URL");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await Promise.any(sources.map(async (source) => {
      const response = await fetch(source, { signal: controller.signal, cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("Image unavailable");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_IMAGE_BYTES) throw new Error("Image too large");
      const input = Buffer.from(await response.arrayBuffer());
      if (input.byteLength > MAX_IMAGE_BYTES) throw new Error("Image too large");
      return input;
    }));
  } finally {
    clearTimeout(timeout);
  }
}

function isSafeImageSource(value: string) {
  return value.startsWith("ipfs://") || isSafeImageUrl(value);
}

function isSafeImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ([
      "raw.githubusercontent.com",
      "coin-images.coingecko.com",
      "assets.coingecko.com",
      "assets.geckoterminal.com",
      "cdn.dexscreener.com",
      "dd.dexscreener.com",
      "cdn.robinhood.com",
      "base.blockscout.com",
      "robinhoodchain.blockscout.com"
    ].includes(url.hostname) || url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".mypinata.cloud"));
  } catch {
    return false;
  }
}
