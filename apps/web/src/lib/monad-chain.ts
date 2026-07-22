import { defineChain } from "viem";
import { monadRpcUrls } from "@/lib/rpc";

const rpcUrls = monadRpcUrls();

export const monadChain = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: {
    default: { http: rpcUrls, webSocket: ["wss://rpc.monad.xyz"] },
    public: { http: rpcUrls }
  },
  blockExplorers: {
    default: {
      name: "MonadVision",
      url: "https://monadvision.com"
    }
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11"
    }
  }
});

export const monadUniswapChainName = "monad";
