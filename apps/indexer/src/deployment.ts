import { defineChain } from "viem";

export const chainId = Number(process.env.CHAIN_ID || "8453");
const robinhood = chainId === 4663;
export const defaultRpcUrl = robinhood ? "https://rpc.mainnet.chain.robinhood.com" : "https://mainnet.base.org";
export const defaultRpcUrls = robinhood
  ? [defaultRpcUrl, ...splitRpcUrls(process.env.ROBINHOOD_RPC_FALLBACK_URLS)]
  : [defaultRpcUrl, "https://base-rpc.publicnode.com", "https://1rpc.io/base", "https://base.meowrpc.com"];

export type IndexerDeployment = {
  version: "legacy" | "current";
  launchFactory: `0x${string}`;
  bondingCurveMarket: `0x${string}`;
  graduationManager: `0x${string}`;
  liquidityLocker?: `0x${string}`;
  startBlock: bigint;
};

export const legacyDeployment: IndexerDeployment = robinhood ? {
  version: "legacy",
  launchFactory: "0x6a05304638bed7c96b78f420c612e84111fad4d1" as `0x${string}`,
  bondingCurveMarket: "0xab7597fecaf3357101a3a4331f512031ef3238f0" as `0x${string}`,
  graduationManager: "0xf6545a701a8cbe80d573043e8ffb8210de913d28" as `0x${string}`,
  liquidityLocker: "0x2d1e48fb40f00ed48f2e16df4a7a587fd063d177" as `0x${string}`,
  startBlock: 5576234n
} : {
  version: "legacy",
  launchFactory: "0xf65ebfdacb1a8e0a8217185aae44f489e53b88f9" as `0x${string}`,
  bondingCurveMarket: "0x4ce2154146eacf745133d7755875767d6a00ee5f" as `0x${string}`,
  graduationManager: "0x0a5769b0c8bff62e2c50014cb76f5cb4fde849c2" as `0x${string}`,
  liquidityLocker: "0x63e79af2821238a5a20716f710c4a9401e64141d" as `0x${string}`,
  startBlock: 48379352n
};

export const mainnetDeployment: IndexerDeployment = robinhood ? {
  version: "current",
  launchFactory: "0x128a32ed2af1787a3fab261bc6158400e2f649c9",
  bondingCurveMarket: "0x795fe5649a78496f51c1594a7b435941fb20adb8",
  graduationManager: "0x55d343fc936463c97b7e89dc0ac08c20a08bfb2a",
  liquidityLocker: "0x2176cbc6cb7e650289fe2ec4417b7a27fd0354d5",
  startBlock: 6131828n
} : {
  version: "current",
  launchFactory: "0x29ce28c9cb3f584eb2548883824acd49881e780a",
  bondingCurveMarket: "0x94d056be6573bcaa4958cceeb242c3c08eff2b95",
  graduationManager: "0xa2b7626f6a92b366e6e787ac4db4840f57f253af",
  liquidityLocker: "0xe309983df86803f62e10d07d9522af005ec08ee4",
  startBlock: 48451170n
};

export const deployments = Array.from(
  new Map([legacyDeployment, mainnetDeployment].map((deployment) => [deployment.bondingCurveMarket, deployment])).values()
);

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

export function scopeForDeployment(deployment: IndexerDeployment) {
  return `${chainId}:${deployment.launchFactory.toLowerCase()}:${deployment.bondingCurveMarket.toLowerCase()}:${deployment.startBlock.toString()}`;
}

function splitRpcUrls(value?: string) {
  return (value || "").split(",").map((url) => url.trim()).filter(Boolean);
}
