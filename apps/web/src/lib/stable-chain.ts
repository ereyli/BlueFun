import { defineChain } from "viem";
import { stableRpcUrls } from "@/lib/rpc";

const rpcUrls = stableRpcUrls();

export const stableChain = defineChain({
  id: 988,
  name: "Stable",
  nativeCurrency: { decimals: 18, name: "USDT0", symbol: "USDT0" },
  rpcUrls: {
    default: { http: rpcUrls, webSocket: ["wss://rpc.stable.xyz"] },
    public: { http: rpcUrls }
  },
  blockExplorers: {
    default: {
      name: "Stablescan",
      url: "https://stablescan.xyz"
    }
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11"
    }
  }
});
