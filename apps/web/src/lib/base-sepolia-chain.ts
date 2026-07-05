import { defineChain } from "viem";

export const baseSepoliaChain = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Sepolia Ether",
    symbol: "ETH"
  },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
    public: { http: ["https://sepolia.base.org"] }
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: "https://sepolia.basescan.org",
      apiUrl: "https://api-sepolia.basescan.org/api"
    }
  },
  testnet: true
});
