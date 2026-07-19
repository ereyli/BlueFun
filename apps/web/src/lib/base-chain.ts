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
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 5022
    }
  }
});

export const uniswapChainName = "base";
