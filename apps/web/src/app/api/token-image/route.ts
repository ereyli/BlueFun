import { NextResponse } from "next/server";
import sharp from "sharp";
import { ipfsToGatewayUrls } from "@/lib/token-metadata";

export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri")?.slice(0, 500) || "";
  const sources = safeImageSources(uri);
  if (sources.length === 0) return NextResponse.json({ error: "Invalid image URI." }, { status: 400 });
  try {
    const input = await fetchFirstImage(sources);
    const output = await sharp(input, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize(384, 384, { fit: "cover", position: "centre" })
      .webp({ quality: 80, effort: 3 })
      .toBuffer();
    return new NextResponse(new Uint8Array(output), {
      headers: {
        "content-type": "image/webp",
        "cache-control": uri.startsWith("ipfs://")
          ? "public, max-age=31536000, s-maxage=31536000, immutable"
          : "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Image unavailable." }, { status: 404 });
  }
}

function safeImageSources(uri: string) {
  if (/^ipfs:\/\/[a-zA-Z0-9]+(?:\/[^?#]*)?$/.test(uri)) return ipfsToGatewayUrls(uri);
  try {
    const url = new URL(uri);
    const configured = process.env.PINATA_GATEWAY_URL ? new URL(process.env.PINATA_GATEWAY_URL).hostname : "";
    const allowedHosts = new Set([configured, "gateway.pinata.cloud", "ipfs.io", "cloudflare-ipfs.com"].filter(Boolean));
    return url.protocol === "https:" && allowedHosts.has(url.hostname) ? [url.toString()] : [];
  } catch {
    return [];
  }
}

async function fetchFirstImage(sources: string[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await Promise.any(sources.map(async (source) => {
      const response = await fetch(source, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Image source unavailable");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 6 * 1024 * 1024) throw new Error("Image is too large");
      const input = Buffer.from(await response.arrayBuffer());
      if (input.byteLength > 6 * 1024 * 1024) throw new Error("Image is too large");
      return input;
    }));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
