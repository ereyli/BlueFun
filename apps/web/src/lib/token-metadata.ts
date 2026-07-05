export type TokenMetadata = {
  imageURI?: string;
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
      const metadata = (await response.json()) as { image?: unknown };
      return {
        imageURI: typeof metadata.image === "string" ? metadata.image : undefined
      };
    } catch {
      // Try the next gateway.
    }
  }

  return {};
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
