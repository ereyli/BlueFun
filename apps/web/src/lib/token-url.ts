import { chainSlug } from "@/lib/chain-slug";

type TokenUrlIdentity = {
  chainId: number;
  name: string;
  symbol: string;
  token: string;
};

export function tokenSlug(token: Pick<TokenUrlIdentity, "name" | "symbol" | "token">) {
  const name = slugPart(token.name) || "token";
  const symbol = slugPart(token.symbol) || "coin";
  const suffix = token.token.toLowerCase().replace(/^0x/, "").slice(-8);
  return `${name}-${symbol}-${suffix}`;
}

export function tokenPath(token: TokenUrlIdentity) {
  return `/token/${chainSlug(token.chainId)}/${tokenSlug(token)}`;
}

export function tokenSuffixFromSlug(slug: string) {
  const suffix = slug.toLowerCase().split("-").at(-1) || "";
  return /^[a-f0-9]{8}$/.test(suffix) ? suffix : undefined;
}

function slugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
