export type SupportedChainId = 8453 | 4663;
export type ChainSlug = "base" | "robinhood";

export function chainSlug(chainId: number | undefined): ChainSlug {
  return chainId === 4663 ? "robinhood" : "base";
}

export function chainIdFromParam(value: string | null | undefined, fallback: SupportedChainId = 8453): SupportedChainId {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "robinhood" || normalized === "4663") return 4663;
  if (normalized === "base" || normalized === "8453") return 8453;
  return fallback;
}

export function namedChainParam(value: string | null | undefined): ChainSlug | undefined {
  if (!value) return undefined;
  return chainSlug(chainIdFromParam(value));
}
