import { defineChain } from "viem";

export const chainId = Number(process.env.CHAIN_ID || "8453");
const robinhood = chainId === 4663;
export const defaultRpcUrl = robinhood ? "https://rpc.mainnet.chain.robinhood.com" : "https://mainnet.base.org";
export const defaultRpcUrls = robinhood
  ? [defaultRpcUrl, ...splitRpcUrls(process.env.ROBINHOOD_RPC_FALLBACK_URLS)]
  : [defaultRpcUrl, "https://base-rpc.publicnode.com", "https://1rpc.io/base"];

export type IndexerDeployment = {
  version: "legacy" | "fee-sharing-v1" | "current" | "vnext";
  launchFactory: `0x${string}`;
  bondingCurveMarket: `0x${string}`;
  graduationManager: `0x${string}`;
  liquidityLocker?: `0x${string}`;
  startBlock: bigint;
};

export type DirectIndexerDeployment = {
  launchFactory: `0x${string}`;
  liquidityLocker: `0x${string}`;
  startBlock: bigint;
  scope: string;
};

export type NFTIndexerDeployment = {
  collectionFactory: `0x${string}`;
  dropController: `0x${string}`;
  marketplace: `0x${string}`;
  pfpFactory?: `0x${string}`;
  pfpMarketplace?: `0x${string}`;
  pfpStartBlock?: bigint;
  offers?: `0x${string}`;
  offersStartBlock?: bigint;
  startBlock: bigint;
  scope: string;
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

export const feeSharingDeployment: IndexerDeployment = robinhood ? {
  version: "fee-sharing-v1",
  launchFactory: "0x128a32ed2af1787a3fab261bc6158400e2f649c9",
  bondingCurveMarket: "0x795fe5649a78496f51c1594a7b435941fb20adb8",
  graduationManager: "0x55d343fc936463c97b7e89dc0ac08c20a08bfb2a",
  liquidityLocker: "0x2176cbc6cb7e650289fe2ec4417b7a27fd0354d5",
  startBlock: 6131828n
} : {
  version: "fee-sharing-v1",
  launchFactory: "0x29ce28c9cb3f584eb2548883824acd49881e780a",
  bondingCurveMarket: "0x94d056be6573bcaa4958cceeb242c3c08eff2b95",
  graduationManager: "0xa2b7626f6a92b366e6e787ac4db4840f57f253af",
  liquidityLocker: "0xe309983df86803f62e10d07d9522af005ec08ee4",
  startBlock: 48451170n
};

export const mainnetDeployment: IndexerDeployment = robinhood ? {
  version: "current",
  launchFactory: "0xb880ea1d3453968243722b9c1529870c796b060f",
  bondingCurveMarket: "0x2d6d77652facbbcae05c0dc3aed792b94cd61fa8",
  graduationManager: "0xeb3e83ab91bd44959ace28b5f1cccb79b4b4092d",
  liquidityLocker: "0x6e77d6418b9065cc947dba95bd1cbba3ca881318",
  startBlock: 9943107n
} : {
  version: "current",
  launchFactory: "0x830569db6364f22cfb5eaa8a0ce17b1382ed3436",
  bondingCurveMarket: "0xb503b0ef06ec10554f4d960e08869877a41498dd",
  graduationManager: "0x250aec1fdffbe663e1fe9bd292529745cabb68ab",
  liquidityLocker: "0x48aa4cb0efb545bc9ccc07dcb380dfb4ab8ab4d5",
  startBlock: 48642000n
};

export const vNextDeployment: IndexerDeployment = robinhood ? {
  version: "vnext",
  launchFactory: "0x32af28dfe63ff9e84399f0af51d5b84b4f3b3c62",
  bondingCurveMarket: "0x2f46a783c1314e160d673f927464d85b7364d807",
  graduationManager: "0x781b14110cd3a9377896722bd9844c26d338e251",
  liquidityLocker: "0x1122c6cab7520278f82928fef1e35448419523b2",
  startBlock: 10703400n
} : {
  version: "vnext",
  launchFactory: "0x820344fb4c0a518d0caef5d3de96ff41cbe6b345",
  bondingCurveMarket: "0x7d42dd1435e9567c1edfb513c45c8ea82fe03a38",
  graduationManager: "0x989bd9259408f73bb17099d37df2ccdc57b271f3",
  liquidityLocker: "0x484345c0fc777d1945a84adb6284d487dafb1de8",
  startBlock: 48678791n
};

export const deployments = Array.from(
  new Map([legacyDeployment, feeSharingDeployment, mainnetDeployment, vNextDeployment]
    .filter((deployment): deployment is IndexerDeployment => Boolean(deployment))
    .map((deployment) => [deployment.bondingCurveMarket, deployment])).values()
);

const configuredDirectFactory = (process.env.DIRECT_LAUNCH_FACTORY
  || (robinhood
    ? "0x7de3165634679353a36886dcfe35e3521beee4a4"
    : "0x0246688cef66734c1cada909cfd202e1448ba275")) as `0x${string}`;
const configuredDirectLocker = (process.env.DIRECT_LIQUIDITY_LOCKER
  || (robinhood
    ? "0x8550c8f626993ffb58a884cb4e9b5b8a9ee2bdf6"
    : "0x2e83029d88d0af58ba55b31980dc709920fab941")) as `0x${string}`;
const configuredDirectStartBlock = BigInt(
  process.env.DIRECT_DEPLOYMENT_BLOCK || (robinhood ? "10703400" : "48647525")
);
const configuredDirectDeployment: DirectIndexerDeployment | undefined =
  configuredDirectFactory && configuredDirectLocker && configuredDirectStartBlock > 0n
    ? {
        launchFactory: configuredDirectFactory,
        liquidityLocker: configuredDirectLocker,
        startBlock: configuredDirectStartBlock,
        scope: `${chainId}:direct:${configuredDirectFactory.toLowerCase()}:${configuredDirectStartBlock.toString()}`
      }
    : undefined;

const legacyCurrentDirectDeployment: DirectIndexerDeployment = robinhood ? {
  launchFactory: "0x9d0e5d76ca2d79ca6ab0c800763eb8e5c39a5079",
  liquidityLocker: "0xe0158cb5c659e95e0ef461e1f7518c4f3b557e81",
  startBlock: 10283960n,
  scope: `${chainId}:direct:0x9d0e5d76ca2d79ca6ab0c800763eb8e5c39a5079:10283960`
} : {
  launchFactory: "0x0246688cef66734c1cada909cfd202e1448ba275",
  liquidityLocker: "0x2e83029d88d0af58ba55b31980dc709920fab941",
  startBlock: 48647525n,
  scope: `${chainId}:direct:0x0246688cef66734c1cada909cfd202e1448ba275:48647525`
};

const vNextDirectDeployment: DirectIndexerDeployment = robinhood ? {
  launchFactory: "0x7de3165634679353a36886dcfe35e3521beee4a4",
  liquidityLocker: "0x8550c8f626993ffb58a884cb4e9b5b8a9ee2bdf6",
  startBlock: 10703400n,
  scope: `${chainId}:direct:0x7de3165634679353a36886dcfe35e3521beee4a4:10703400`
} : {
  launchFactory: "0x394c5d0244b49e1eed533cd3505583e504589157",
  liquidityLocker: "0x857f7d11474235d8cafd79826d4d2e0d2b7dabd7",
  startBlock: 48678791n,
  scope: `${chainId}:direct:0x394c5d0244b49e1eed533cd3505583e504589157:48678791`
};

export const directDeployments = Array.from(new Map(
  [legacyCurrentDirectDeployment, configuredDirectDeployment, vNextDirectDeployment]
    .filter((deployment): deployment is DirectIndexerDeployment => Boolean(deployment))
    .map((deployment) => [deployment.scope, deployment])
).values());

const nftFactory = (process.env.NFT_COLLECTION_FACTORY
  || (!robinhood ? "0x342F90f22fBd5f7D680d3d84Ce121BDA995F6F4D" : undefined)) as `0x${string}` | undefined;
const nftController = (process.env.NFT_DROP_CONTROLLER
  || (!robinhood ? "0xb129417fFc25b5A8e918Cb63E6f45a605905C0aC" : undefined)) as `0x${string}` | undefined;
const nftMarketplace = (process.env.NFT_MARKETPLACE
  || (!robinhood ? "0xf08f44AC84632c7E3dF2E63804fB8eECb4B346bb" : undefined)) as `0x${string}` | undefined;
const nftStartBlock = BigInt(process.env.NFT_DEPLOYMENT_BLOCK || (!robinhood ? "48766938" : "0"));
const nftPFPFactory = process.env.NFT_PFP_FACTORY as `0x${string}` | undefined;
const nftPFPMarketplace = process.env.NFT_PFP_MARKETPLACE as `0x${string}` | undefined;
const nftPFPStartBlock = BigInt(process.env.NFT_PFP_DEPLOYMENT_BLOCK || "0");
const nftOffers = process.env.NFT_OFFERS as `0x${string}` | undefined;
const nftOffersStartBlock = BigInt(process.env.NFT_OFFERS_DEPLOYMENT_BLOCK || "0");
export const nftDeployment: NFTIndexerDeployment | undefined =
  nftFactory && nftController && nftMarketplace && nftStartBlock > 0n
    ? {
        collectionFactory: nftFactory,
        dropController: nftController,
        marketplace: nftMarketplace,
        pfpFactory: nftPFPFactory,
        pfpMarketplace: nftPFPMarketplace,
        pfpStartBlock: nftPFPStartBlock > 0n ? nftPFPStartBlock : undefined,
        offers: nftOffers,
        offersStartBlock: nftOffersStartBlock > 0n ? nftOffersStartBlock : undefined,
        startBlock: nftStartBlock,
        scope: `${chainId}:nft:${nftFactory.toLowerCase()}:${nftStartBlock.toString()}`
      }
    : undefined;

const nftV2Deployment: NFTIndexerDeployment | undefined = !robinhood ? {
  collectionFactory: (process.env.NFT_V2_COLLECTION_FACTORY || "0x38d3a8ee94f49ddeb7ba5c0f202e1aaf4b07c63a") as `0x${string}`,
  dropController: (process.env.NFT_V2_DROP_CONTROLLER || "0xa799002045291b4c88db11d35f476f532ea012cb") as `0x${string}`,
  marketplace: (process.env.NFT_V2_MARKETPLACE || "0x79509ab5348ecc30616ce7a8460d014cfee5737b") as `0x${string}`,
  pfpFactory: (process.env.NFT_V2_PFP_FACTORY || "0x5c1796111e6e57d0d13555da1cdb2b1a98005732") as `0x${string}`,
  pfpMarketplace: (process.env.NFT_V2_PFP_MARKETPLACE || "0x22c0b3344af12de3a5f6315663af2c9b9042e9f8") as `0x${string}`,
  pfpStartBlock: BigInt(process.env.NFT_V2_DEPLOYMENT_BLOCK || "48813200"),
  offers: (process.env.NFT_V2_OFFERS || "0x58b7e9f6c980800754cde5c9458e2ec42ebeb0ca") as `0x${string}`,
  offersStartBlock: BigInt(process.env.NFT_V2_DEPLOYMENT_BLOCK || "48813200"),
  startBlock: BigInt(process.env.NFT_V2_DEPLOYMENT_BLOCK || "48813200"),
  scope: `${chainId}:nft-v2:${(process.env.NFT_V2_COLLECTION_FACTORY || "0x38d3a8ee94f49ddeb7ba5c0f202e1aaf4b07c63a").toLowerCase()}:${process.env.NFT_V2_DEPLOYMENT_BLOCK || "48813200"}`
} : undefined;

export const nftDeployments = [nftDeployment, nftV2Deployment].filter((deployment): deployment is NFTIndexerDeployment => Boolean(deployment));

export const chainDefinition = defineChain({
  id: chainId,
  name: robinhood ? "Robinhood Chain" : "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: defaultRpcUrls } },
  blockExplorers: { default: { name: robinhood ? "Robinhood Explorer" : "BaseScan", url: robinhood ? "https://robinhoodchain.blockscout.com" : "https://basescan.org" } },
  contracts: robinhood ? undefined : {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 5022
    }
  }
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
