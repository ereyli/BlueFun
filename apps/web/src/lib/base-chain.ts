import { defineChain } from "viem";

export const baseChain = defineChain({
  id: 8453,
  name: "Base",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH"
  },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org"] },
    public: { http: [process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org"] }
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: "https://basescan.org",
      apiUrl: "https://api.basescan.org/api"
    }
  }
});

export const uniswapChainName = "base";
