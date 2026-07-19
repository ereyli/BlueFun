import { NextResponse } from "next/server";
import { assertRateLimit, assertRequestSize, assertSameOrigin, RequestGuardError } from "@/lib/server/request-guard";
import { isSafeIpfsUri } from "@/lib/server/image-validation";

export const runtime = "nodejs";
const ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRequestSize(request, 32 * 1024);
    await assertRateLimit(request, "pinata-nft-metadata");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload unavailable." },
      { status: error instanceof RequestGuardError ? error.status : 503 });
  }
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "NFT metadata uploads are not available right now." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = clean(body.name, 64);
  const symbol = clean(body.symbol, 16).toUpperCase();
  const description = clean(body.description, 1000);
  const image = clean(body.image, 160);
  const logoImage = clean(body.logoImage, 160);
  const externalUrl = safeUrl(body.externalUrl);
  const xUrl = safeUrl(body.xUrl, ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
  const telegramUrl = safeUrl(body.telegramUrl, ["t.me", "telegram.me", "www.telegram.me"]);
  const supply = Math.max(1, Math.floor(Number(body.supply || 1)));
  const royaltyBps = Math.min(1000, Math.max(0, Math.floor(Number(body.royaltyBps || 0))));
  if (!name || !symbol || !isSafeIpfsUri(image) || (logoImage && !isSafeIpfsUri(logoImage)) || !Number.isSafeInteger(supply)) {
    return NextResponse.json({ error: "Valid name, symbol, image and supply are required." }, { status: 400 });
  }
  try {
    const item = await pin(jwt, `${symbol}-item-1.json`, {
      name, description, image, external_url: externalUrl || undefined,
      attributes: [{ trait_type: "Edition supply", value: supply }, { trait_type: "Launchpad", value: "BlueFun" }]
    });
    const collection = await pin(jwt, `${symbol}-collection.json`, {
      name, description, image: logoImage || image, external_link: externalUrl || undefined,
      socials: { website: externalUrl || undefined, x: xUrl || undefined, twitter: xUrl || undefined, telegram: telegramUrl || undefined },
      seller_fee_basis_points: royaltyBps, fee_recipient: safeAddress(body.royaltyRecipient)
    });
    return NextResponse.json({ itemURI: `ipfs://${item}`, contractURI: `ipfs://${collection}` });
  } catch {
    return NextResponse.json({ error: "NFT metadata could not be pinned. Please try again." }, { status: 502 });
  }
}

async function pin(jwt: string, fileName: string, content: object) {
  const response = await fetch(ENDPOINT, {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: { name: fileName } })
  });
  if (!response.ok) throw new Error("Pinata request failed");
  return ((await response.json()) as { IpfsHash: string }).IpfsHash;
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeUrl(value: unknown, allowedHosts?: string[]) {
  const raw = clean(value, 240); if (!raw) return "";
  try { const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); return url.protocol === "https:" && (!allowedHosts || allowedHosts.includes(url.hostname.toLowerCase())) ? url.toString() : ""; }
  catch { return ""; }
}
function safeAddress(value: unknown) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : undefined;
}
