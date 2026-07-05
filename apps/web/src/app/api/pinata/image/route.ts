import { NextResponse } from "next/server";
import { assertRateLimit, assertSameOrigin } from "@/lib/server/request-guard";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PINATA_FILE_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";

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
    return NextResponse.json({ error: "Image uploads are not available right now." }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("image");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Select an image before continuing." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Please select a valid image file." }, { status: 400 });
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image must be 5 MB or smaller." }, { status: 400 });
  }

  try {
    const imageForm = new FormData();
    imageForm.append("file", file, safeFileName(file.name || "token-image.png"));
    imageForm.append("pinataMetadata", JSON.stringify({ name: safeFileName(file.name || "token-image") }));

    const result = await pinataFetch<{ IpfsHash: string }>(PINATA_FILE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: imageForm
    });

    const imageUri = `ipfs://${result.IpfsHash}`;
    return NextResponse.json({
      imageUri,
      imageGatewayUrl: ipfsToGatewayUrl(imageUri)
    });
  } catch {
    return NextResponse.json(
      { error: "Image could not be uploaded. Please try again." },
      { status: 502 }
    );
  }
}

async function pinataFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error("Pinata upload failed");
  return (await response.json()) as T;
}

function safeFileName(name: string) {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return clean || "token-image.png";
}

function ipfsToGatewayUrl(uri: string) {
  const gateway = process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
  return `${gateway.replace(/\/$/, "")}/${uri.replace("ipfs://", "")}`;
}
