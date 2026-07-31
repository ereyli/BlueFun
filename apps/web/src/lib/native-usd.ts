import "server-only";

const PRICE_TTL_MS = 30_000;
const priceCache = new Map<number, { expiresAt: number; value: number | null }>();

export function nativeSymbolForChain(chainId: number) {
  if (chainId === 5042) return "USDC";
  if (chainId === 988) return "USDT0";
  if (chainId === 143) return "MON";
  return "ETH";
}

export async function getNativeUsdPrice(chainId: number) {
  const cached = priceCache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: number | null = null;
  try {
    if (chainId === 988 || chainId === 5042) {
      value = 1;
    } else if (chainId === 143) {
      const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd", {
        headers: { accept: "application/json" },
        next: { revalidate: 30 }
      });
      if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
      const payload = await response.json() as { monad?: { usd?: number } };
      const amount = Number(payload.monad?.usd);
      value = Number.isFinite(amount) && amount > 0 ? amount : null;
    } else {
      const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
        headers: { accept: "application/json" },
        next: { revalidate: 30 }
      });
      if (!response.ok) throw new Error(`Coinbase returned ${response.status}`);
      const payload = await response.json() as { data?: { amount?: string } };
      const amount = Number(payload.data?.amount);
      value = Number.isFinite(amount) && amount > 0 ? amount : null;
    }
  } catch {
    value = null;
  }

  priceCache.set(chainId, { expiresAt: Date.now() + PRICE_TTL_MS, value });
  return value;
}
