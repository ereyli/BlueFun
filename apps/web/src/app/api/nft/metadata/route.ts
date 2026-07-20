import { NextResponse } from "next/server";
import { ipfsToGatewayUrls } from "@/lib/token-metadata";

const MAX_METADATA_BYTES = 256 * 1024;

export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri")?.slice(0, 500) || "";
  const sources = ipfsToGatewayUrls(uri);
  if (sources.length === 0) return NextResponse.json({ error: "Invalid metadata URI." }, { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const metadata = await Promise.any(sources.map((source) => fetchMetadata(source, controller.signal)));
    return NextResponse.json(metadata, {
      headers: {
        "cache-control": uri.startsWith("ipfs://")
          ? "public, max-age=31536000, s-maxage=31536000, immutable"
          : "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return NextResponse.json({ error: "Metadata unavailable." }, { status: 404 });
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function fetchMetadata(source: string, signal: AbortSignal) {
  const response = await fetch(source, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Metadata source unavailable");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_METADATA_BYTES) throw new Error("Metadata is too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_METADATA_BYTES) throw new Error("Metadata is too large");
  const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid metadata");
  return metadata;
}
