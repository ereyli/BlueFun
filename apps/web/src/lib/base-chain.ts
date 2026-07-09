import { defineChain } from "viem";
import { baseRpcUrls } from "@/lib/rpc";

const rpcUrls = baseRpcUrls();

export const baseChain = defineChain({
  id: 8453,
  name: "Base",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH"
  },
  rpcUrls: {
    default: { http: rpcUrls },
    public: { http: rpcUrls }
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
