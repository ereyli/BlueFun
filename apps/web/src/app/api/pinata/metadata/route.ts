import { NextResponse } from "next/server";
import { assertRateLimit, assertSameOrigin } from "@/lib/server/request-guard";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PINATA_FILE_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload is temporarily unavailable." },
      { status: 429 }
    );
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return NextResponse.json({ error: "Launch media uploads are not available right now." }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("image");
  const existingImageUri = cleanText(form.get("imageUri"), 120);
  const name = cleanText(form.get("name"), 80);
  const symbol = cleanText(form.get("symbol"), 20).toUpperCase();
  const description = cleanText(form.get("description"), 500);
  const website = cleanUrl(form.get("website"));
  const twitter = cleanUrl(form.get("twitter"));
  const telegram = cleanUrl(form.get("telegram"));
  const discord = cleanUrl(form.get("discord"));

  if (!name || !symbol) {
    return NextResponse.json({ error: "Token name and symbol are required before uploading metadata." }, { status: 400 });
  }

  if (!existingImageUri && !(file instanceof File)) {
    return NextResponse.json({ error: "Token image file is required." }, { status: 400 });
  }

  if (file instanceof File && !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files can be uploaded." }, { status: 400 });
  }

  if (file instanceof File && file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image must be 5 MB or smaller." }, { status: 400 });
  }

  try {
    let imageUri = existingImageUri;
    if (!imageUri && file instanceof File) {
      const imageForm = new FormData();
      imageForm.append("file", file, safeFileName(file.name || `${symbol}.png`));
      imageForm.append("pinataMetadata", JSON.stringify({ name: `${symbol}-image` }));

      const imageResult = await pinataFetch<{ IpfsHash: string }>(PINATA_FILE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: imageForm
      });
      imageUri = `ipfs://${imageResult.IpfsHash}`;
    }

    const metadata = {
      name,
      symbol,
      description: description || `${name} (${symbol}) launched on BlueFun.`,
      image: imageUri,
      external_url: website || undefined,
      socials: {
        website: website || undefined,
        twitter: twitter || undefined,
        telegram: telegram || undefined,
        discord: discord || undefined
      },
      attributes: [
        { trait_type: "Network", value: "Base Sepolia" },
        { trait_type: "Launchpad", value: "BlueFun" },
        { trait_type: "Graduation Target", value: "5 ETH" }
      ]
    };

    const metadataResult = await pinataFetch<{ IpfsHash: string }>(PINATA_JSON_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: `${symbol}-metadata.json` }
      })
    });

    const metadataUri = `ipfs://${metadataResult.IpfsHash}`;

    return NextResponse.json({
      imageUri,
      imageGatewayUrl: ipfsToGatewayUrl(imageUri),
      metadataUri,
      metadataGatewayUrl: ipfsToGatewayUrl(metadataUri)
    });
  } catch (error) {
    return NextResponse.json({ error: "Launch media could not be prepared. Please try again." }, { status: 502 });
  }
}

async function pinataFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    let message = text || `Pinata request failed with ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { details?: string; reason?: string }; message?: string };
      message = parsed.error?.details || parsed.error?.reason || parsed.message || message;
    } catch {
      // Keep raw Pinata response text.
    }
    throw new Error(message);
  }

  return JSON.parse(text) as T;
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanUrl(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  const raw = value.trim().slice(0, 240);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function safeFileName(name: string) {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return clean || "token-image.png";
}

function ipfsToGatewayUrl(uri: string) {
  const gateway = process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
  return `${gateway.replace(/\/$/, "")}/${uri.replace("ipfs://", "")}`;
}
