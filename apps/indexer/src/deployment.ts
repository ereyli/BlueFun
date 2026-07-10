import { defineChain } from "viem";

export const chainId = Number(process.env.CHAIN_ID || "8453");
const robinhood = chainId === 4663;
export const defaultRpcUrl = robinhood ? "https://rpc.mainnet.chain.robinhood.com" : "https://mainnet.base.org";
export const defaultRpcUrls = robinhood
  ? [defaultRpcUrl, ...splitRpcUrls(process.env.ROBINHOOD_RPC_FALLBACK_URLS)]
  : [defaultRpcUrl, "https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://base.meowrpc.com"];

export const mainnetDeployment = robinhood ? {
  launchFactory: "0x6a05304638bed7c96b78f420c612e84111fad4d1" as `0x${string}`,
  bondingCurveMarket: "0xab7597fecaf3357101a3a4331f512031ef3238f0" as `0x${string}`,
  graduationManager: "0xf6545a701a8cbe80d573043e8ffb8210de913d28" as `0x${string}`,
  startBlock: 5576234n
} : {
  launchFactory: "0xf65ebfdacb1a8e0a8217185aae44f489e53b88f9" as `0x${string}`,
  bondingCurveMarket: "0x4ce2154146eacf745133d7755875767d6a00ee5f" as `0x${string}`,
  graduationManager: "0x0a5769b0c8bff62e2c50014cb76f5cb4fde849c2" as `0x${string}`,
  startBlock: 48379352n
};

export const chainDefinition = defineChain({
  id: chainId,
  name: robinhood ? "Robinhood Chain" : "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: defaultRpcUrls } },
  blockExplorers: { default: { name: robinhood ? "Robinhood Explorer" : "BaseScan", url: robinhood ? "https://robinhoodchain.blockscout.com" : "https://basescan.org" } }
});

export const poolManager = robinhood
  ? "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const
  : "0x498581ff718922c3f8e6a244956af099b2652b2b" as const;

export function deploymentScope() {
  if (!mainnetDeployment.launchFactory || !mainnetDeployment.bondingCurveMarket || mainnetDeployment.startBlock === 0n) return "";
  return `${chainId}:${mainnetDeployment.launchFactory.toLowerCase()}:${mainnetDeployment.bondingCurveMarket.toLowerCase()}:${mainnetDeployment.startBlock.toString()}`;
}

function splitRpcUrls(value?: string) {
  return (value || "").split(",").map((url) => url.trim()).filter(Boolean);
}
