import Image from "next/image";

export type DexProvider = "uniswap" | "ekubo";

const DEX_ASSETS: Record<DexProvider, string> = {
  uniswap: "/dex/uniswap.svg",
  ekubo: "/dex/ekubo.svg"
};

export function DexProviderIcon({ provider, size = 20 }: { provider: DexProvider; size?: number }) {
  return <Image aria-hidden className={`dex-provider-icon ${provider}`} src={DEX_ASSETS[provider]} alt="" height={size} width={size} />;
}
