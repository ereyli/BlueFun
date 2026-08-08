export const SOLANA_CHAIN_ID = 101 as const;
export type SupportedChainId = 8453 | 4663 | 143 | 988 | 5042 | typeof SOLANA_CHAIN_ID;
export type ChainSlug = "base" | "robinhood" | "monad" | "stable" | "arc" | "solana";

export function chainSlug(chainId: number | undefined): ChainSlug {
  if (chainId === SOLANA_CHAIN_ID) return "solana";
  if (chainId === 4663) return "robinhood";
  if (chainId === 143) return "monad";
  if (chainId === 988) return "stable";
  if (chainId === 5042) return "arc";
  return "base";
}

export function chainIdFromParam(value: string | null | undefined, fallback: SupportedChainId = 8453): SupportedChainId {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "solana" || normalized === "sol" || normalized === "101") return SOLANA_CHAIN_ID;
  if (normalized === "robinhood" || normalized === "4663") return 4663;
  if (normalized === "monad" || normalized === "143") return 143;
  if (normalized === "stable" || normalized === "988") return 988;
  if (normalized === "arc" || normalized === "5042") return 5042;
  if (normalized === "base" || normalized === "8453") return 8453;
  return fallback;
}

export function namedChainParam(value: string | null | undefined): ChainSlug | undefined {
  if (!value) return undefined;
  return chainSlug(chainIdFromParam(value));
}

export function chainSlugFromPath(pathname: string): ChainSlug | undefined {
  const match = pathname.match(/^\/token\/(base|robinhood|monad|stable|arc|solana)(?:\/|$)/);
  return match?.[1] as ChainSlug | undefined;
}
