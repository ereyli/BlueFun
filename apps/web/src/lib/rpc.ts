export const DEFAULT_BASE_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
  "https://base.meowrpc.com"
];

export function baseRpcUrls() {
  return uniqueUrls([
    ...splitRpcUrls(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    ...splitRpcUrls(process.env.NEXT_PUBLIC_BASE_RPC_FALLBACK_URLS),
    ...DEFAULT_BASE_RPC_URLS
  ]);
}

function splitRpcUrls(value?: string) {
  return (value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls));
}
