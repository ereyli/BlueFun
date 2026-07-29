import { defineChain } from "viem";
import { arcRpcUrls } from "@/lib/rpc";

const rpcUrls = arcRpcUrls();

export const arcChain = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
  rpcUrls: {
    default: { http: rpcUrls },
    public: { http: rpcUrls }
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || "https://arc.exploreme.pro"
    }
  }
});
