export type TokenMetadata = {
  description?: string;
  imageURI?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
};

const METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const METADATA_TIMEOUT_MS = 2_000;
const metadataCache = new Map<string, { data?: TokenMetadata; expiresAt: number; promise?: Promise<TokenMetadata> }>();

export async function readTokenMetadata(contractURI: string): Promise<TokenMetadata> {
  if (!contractURI) return {};

  const cached = metadataCache.get(contractURI);
  if (cached?.data && cached.expiresAt > Date.now()) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = loadTokenMetadata(contractURI);
  metadataCache.set(contractURI, { expiresAt: Date.now() + METADATA_CACHE_TTL_MS, promise });

  try {
    const data = await promise;
    metadataCache.set(contractURI, { data, expiresAt: Date.now() + METADATA_CACHE_TTL_MS });
    return data;
  } catch {
    metadataCache.delete(contractURI);
    return {};
  }
}

async function loadTokenMetadata(contractURI: string): Promise<TokenMetadata> {
  if (!contractURI) return {};

  const urls = ipfsToGatewayUrls(contractURI);
  if (urls.length === 0) return {};

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
      const response = await fetch(url, { signal: controller.signal, next: { revalidate: 300 } });
      clearTimeout(timeout);

      if (!response.ok) continue;
      const metadata = (await response.json()) as {
        description?: unknown;
        external_url?: unknown;
        image?: unknown;
        socials?: Record<string, unknown>;
      };
      return {
        description: cleanMetadataText(metadata.description, 500),
        imageURI: typeof metadata.image === "string" ? metadata.image : undefined,
        website: cleanMetadataUrl(metadata.socials?.website) || cleanMetadataUrl(metadata.external_url),
        twitter: cleanMetadataUrl(metadata.socials?.twitter),
        telegram: cleanMetadataUrl(metadata.socials?.telegram),
        discord: cleanMetadataUrl(metadata.socials?.discord)
      };
    } catch {
      // Try the next gateway.
    }
  }

  return {};
}

function cleanMetadataText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || undefined;
}

function cleanMetadataUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().slice(0, 240);
  if (!clean) return undefined;
  try {
    const url = new URL(clean);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function ipfsToGatewayUrl(uri?: string) {
  return ipfsToGatewayUrls(uri)[0] || "";
}

export function optimizedTokenImageUrl(uri?: string) {
  if (isBlueFunCdnUrl(uri)) return uri;
  return uri ? `/api/token-image?uri=${encodeURIComponent(uri)}` : "";
}

export function ipfsToGatewayUrls(uri?: string) {
  if (!uri) return [];
  if (uri.startsWith("https://") || uri.startsWith("http://")) return [uri];
  if (!uri.startsWith("ipfs://")) return [];
  const cidPath = uri.replace("ipfs://", "");
  const gateway = process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
  return [
    `${gateway.replace(/\/$/, "")}/${cidPath}`,
    `https://ipfs.io/ipfs/${cidPath}`,
    `https://cloudflare-ipfs.com/ipfs/${cidPath}`
  ];
}

function isBlueFunCdnUrl(uri?: string) {
  try {
    const url = new URL(uri || "");
    const configuredCdn = process.env.NEXT_PUBLIC_TOKEN_IMAGE_CDN_URL?.replace(/\/$/, "");
    if (configuredCdn && uri?.startsWith(`${configuredCdn}/`)) return true;
    return url.protocol === "https:"
      && url.hostname.endsWith(".supabase.co")
      && url.pathname.startsWith("/storage/v1/object/public/bluefun-token-images/");
  } catch {
    return false;
  }
}
