export type TokenMetadata = {
  description?: string;
  imageURI?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
};

export async function readTokenMetadata(contractURI: string): Promise<TokenMetadata> {
  if (!contractURI) return {};

  const urls = ipfsToGatewayUrls(contractURI);
  if (urls.length === 0) return {};

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6_000);
      const response = await fetch(url, { signal: controller.signal, next: { revalidate: 30 } });
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

function ipfsToGatewayUrls(uri?: string) {
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
