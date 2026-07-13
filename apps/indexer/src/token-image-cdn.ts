import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "bluefun-token-images";
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
let storage: SupabaseClient | undefined;
let bucketReady: Promise<void> | undefined;

export async function mirrorTokenImage(imageUri: string, chainId: number, token: string) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return undefined;

  const input = await downloadImage(imageUri);
  if (!input) return undefined;

  const output = await sharp(input, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const client = getStorage();
  await ensureBucket(client);

  const path = `${chainId}/${token.toLowerCase()}.webp`;
  const { error } = await client.storage.from(BUCKET).upload(path, output, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: true
  });
  if (error) throw error;

  const configuredCdn = process.env.TOKEN_IMAGE_CDN_URL?.replace(/\/$/, "");
  return configuredCdn
    ? `${configuredCdn}/${path}`
    : client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function readMetadataImage(contractUri: string) {
  for (const url of gatewayUrls(contractUri)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) continue;
      const metadata = await response.json() as { image?: unknown };
      if (typeof metadata.image === "string" && metadata.image.length <= 240) return metadata.image;
    } catch {
      // Try the next gateway.
    }
  }
  return undefined;
}

export function isBlueFunCdnUrl(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:"
      && url.hostname.endsWith(".supabase.co")
      && url.pathname.startsWith(`/storage/v1/object/public/${BUCKET}/`);
  } catch {
    return false;
  }
}

async function downloadImage(uri: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await Promise.any(gatewayUrls(uri).map(async (url) => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Image gateway returned ${response.status}`);
      const size = Number(response.headers.get("content-length") || 0);
      if (size > MAX_SOURCE_BYTES) throw new Error("Image is too large");
      const input = Buffer.from(await response.arrayBuffer());
      if (input.byteLength > MAX_SOURCE_BYTES) throw new Error("Image is too large");
      return input;
    }));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function gatewayUrls(uri: string) {
  if (uri.startsWith("https://") || uri.startsWith("http://")) return [uri];
  if (!uri.startsWith("ipfs://")) return [];
  const cidPath = uri.slice("ipfs://".length);
  const configured = (process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");
  return [`${configured}/${cidPath}`, `https://ipfs.io/ipfs/${cidPath}`, `https://cloudflare-ipfs.com/ipfs/${cidPath}`];
}

function getStorage() {
  storage ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false }
  });
  return storage;
}

async function ensureBucket(client: SupabaseClient) {
  bucketReady ??= (async () => {
    const { data, error } = await client.storage.listBuckets();
    if (error) throw error;
    if (data.some((bucket) => bucket.name === BUCKET)) return;
    const { error: createError } = await client.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: String(MAX_SOURCE_BYTES),
      allowedMimeTypes: ["image/webp"]
    });
    if (createError && !/already exists/i.test(createError.message)) throw createError;
  })();
  await bucketReady;
}
