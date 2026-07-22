export const DEFAULT_BASE_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org"
];

export const DEFAULT_ROBINHOOD_RPC_URLS = ["https://rpc.mainnet.chain.robinhood.com"];
export const DEFAULT_MONAD_RPC_URLS = ["https://rpc.monad.xyz", "https://rpc1.monad.xyz"];

export function baseRpcUrls() {
  return uniqueUrls([
    ...splitRpcUrls(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    ...splitRpcUrls(process.env.NEXT_PUBLIC_BASE_RPC_FALLBACK_URLS),
    ...DEFAULT_BASE_RPC_URLS
  ]);
}

export function robinhoodRpcUrls() {
  return uniqueUrls([
    ...splitRpcUrls(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL),
    ...splitRpcUrls(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_FALLBACK_URLS),
    ...DEFAULT_ROBINHOOD_RPC_URLS
  ]);
}

export function monadRpcUrls() {
  return uniqueUrls([
    ...splitRpcUrls(process.env.NEXT_PUBLIC_MONAD_RPC_URL),
    ...splitRpcUrls(process.env.NEXT_PUBLIC_MONAD_RPC_FALLBACK_URLS),
    ...DEFAULT_MONAD_RPC_URLS
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
