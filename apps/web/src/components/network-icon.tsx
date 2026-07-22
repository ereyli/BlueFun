import Image from "next/image";

const NETWORKS = {
  8453: { name: "Base", symbol: "ETH", icon: "/networks/base.svg", tone: "base" },
  4663: { name: "Robinhood", symbol: "ETH", icon: "/networks/robinhood.svg", tone: "robinhood" },
  143: { name: "Monad", symbol: "MON", icon: "/networks/monad.svg", tone: "monad" }
} as const;

export type SupportedChainId = keyof typeof NETWORKS;

export function networkMeta(chainId: number) {
  return NETWORKS[chainId as SupportedChainId] || NETWORKS[8453];
}

export function NetworkIcon({ chainId, size = 22 }: { chainId: number; size?: number }) {
  const network = networkMeta(chainId);
  return (
    <span className={`network-icon ${network.tone}`} style={{ height: size, width: size }} aria-hidden="true">
      <Image src={network.icon} alt="" width={size} height={size} />
    </span>
  );
}
