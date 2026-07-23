import { defineChain } from "viem";

export const chainId = Number(process.env.CHAIN_ID || "8453");
const robinhood = chainId === 4663;
const monad = chainId === 143;
const stable = chainId === 988;
const base = chainId === 8453;
export const defaultRpcUrl = stable ? "https://rpc.stable.xyz" : monad ? "https://rpc.monad.xyz" : robinhood ? "https://rpc.mainnet.chain.robinhood.com" : "https://mainnet.base.org";
export const defaultRpcUrls = stable
  ? [defaultRpcUrl, "https://lb.routeme.sh/rpc/evm/988", ...splitRpcUrls(process.env.STABLE_RPC_FALLBACK_URLS)]
  : monad
  ? [defaultRpcUrl, "https://rpc1.monad.xyz", ...splitRpcUrls(process.env.MONAD_RPC_FALLBACK_URLS)]
  : robinhood
  ? [defaultRpcUrl, ...splitRpcUrls(process.env.ROBINHOOD_RPC_FALLBACK_URLS)]
  : [defaultRpcUrl, "https://base-rpc.publicnode.com", "https://base.drpc.org"];

export type IndexerDeployment = {
  version: "legacy" | "fee-sharing-v1" | "current" | "vnext";
  launchFactory: `0x${string}`;
  bondingCurveMarket: `0x${string}`;
  graduationManager: `0x${string}`;
  liquidityLocker?: `0x${string}`;
  feeHook?: `0x${string}`;
  startBlock: bigint;
};

export type DirectIndexerDeployment = {
  launchFactory: `0x${string}`;
  liquidityLocker: `0x${string}`;
  startBlock: bigint;
  scope: string;
  dexVersion: "v3" | "v4";
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

export const legacyDeployment: IndexerDeployment | undefined = stable || monad ? undefined : robinhood ? {
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

export const feeSharingDeployment: IndexerDeployment | undefined = stable || monad ? undefined : robinhood ? {
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

export const mainnetDeployment: IndexerDeployment | undefined = stable || monad ? undefined : robinhood ? {
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

export const vNextDeployment: IndexerDeployment | undefined = stable ? undefined : monad ? configuredMonadBondDeployment() : robinhood ? {
  version: "vnext",
  launchFactory: "0x32af28dfe63ff9e84399f0af51d5b84b4f3b3c62",
  bondingCurveMarket: "0x2f46a783c1314e160d673f927464d85b7364d807",
  graduationManager: "0x781b14110cd3a9377896722bd9844c26d338e251",
  liquidityLocker: "0x1122c6cab7520278f82928fef1e35448419523b2",
  feeHook: "0x4c77a461669c0345960dd33d415747c8932f60cc",
  startBlock: 10703400n
} : {
  version: "vnext",
  launchFactory: "0x820344fb4c0a518d0caef5d3de96ff41cbe6b345",
  bondingCurveMarket: "0x7d42dd1435e9567c1edfb513c45c8ea82fe03a38",
  graduationManager: "0x989bd9259408f73bb17099d37df2ccdc57b271f3",
  liquidityLocker: "0x484345c0fc777d1945a84adb6284d487dafb1de8",
  feeHook: "0xf0b8dde19510ee7d6d50be289c4257ecd14c60cc",
  startBlock: 48678791n
};

export const deployments = Array.from(
  new Map([legacyDeployment, feeSharingDeployment, mainnetDeployment, vNextDeployment]
    .filter((deployment): deployment is IndexerDeployment => Boolean(deployment))
    .map((deployment) => [deployment.bondingCurveMarket, deployment])).values()
);

const configuredDirectFactory = (process.env.DIRECT_LAUNCH_FACTORY
  || (stable ? "0xc2c29581179111aa94ba12affd3486879e42090c" : monad ? "0x773260193799321547BFeF0616cf57b3D7aa3412" : robinhood
    ? "0x7de3165634679353a36886dcfe35e3521beee4a4"
    : "0x0246688cef66734c1cada909cfd202e1448ba275")) as `0x${string}`;
const configuredDirectLocker = (process.env.DIRECT_LIQUIDITY_LOCKER
  || (stable ? "0x8d51017c392552333a679ccb60b5df84314c64cd" : monad ? "0xb5fAb655a3b7187175Ac339075DA11542e58d81d" : robinhood
    ? "0x8550c8f626993ffb58a884cb4e9b5b8a9ee2bdf6"
    : "0x2e83029d88d0af58ba55b31980dc709920fab941")) as `0x${string}`;
const configuredDirectStartBlock = BigInt(
  process.env.DIRECT_DEPLOYMENT_BLOCK || (stable ? "32827109" : monad ? "89311452" : robinhood ? "10703400" : "48647525")
);
const configuredDirectDeployment: DirectIndexerDeployment | undefined =
  configuredDirectFactory && configuredDirectLocker && configuredDirectStartBlock > 0n
    ? {
        launchFactory: configuredDirectFactory,
        liquidityLocker: configuredDirectLocker,
        startBlock: configuredDirectStartBlock,
        scope: `${chainId}:direct:${configuredDirectFactory.toLowerCase()}:${configuredDirectStartBlock.toString()}`,
        dexVersion: stable ? "v3" : "v4"
      }
    : undefined;

const legacyCurrentDirectDeployment: DirectIndexerDeployment | undefined = stable || monad ? undefined : robinhood ? {
  launchFactory: "0x9d0e5d76ca2d79ca6ab0c800763eb8e5c39a5079",
  liquidityLocker: "0xe0158cb5c659e95e0ef461e1f7518c4f3b557e81",
  startBlock: 10283960n,
  scope: `${chainId}:direct:0x9d0e5d76ca2d79ca6ab0c800763eb8e5c39a5079:10283960`,
  dexVersion: "v4"
} : {
  launchFactory: "0x0246688cef66734c1cada909cfd202e1448ba275",
  liquidityLocker: "0x2e83029d88d0af58ba55b31980dc709920fab941",
  startBlock: 48647525n,
  scope: `${chainId}:direct:0x0246688cef66734c1cada909cfd202e1448ba275:48647525`,
  dexVersion: "v4"
};

const vNextDirectDeployment: DirectIndexerDeployment | undefined = stable || monad ? undefined : robinhood ? {
  launchFactory: "0x7de3165634679353a36886dcfe35e3521beee4a4",
  liquidityLocker: "0x8550c8f626993ffb58a884cb4e9b5b8a9ee2bdf6",
  startBlock: 10703400n,
  scope: `${chainId}:direct:0x7de3165634679353a36886dcfe35e3521beee4a4:10703400`,
  dexVersion: "v4"
} : {
  launchFactory: "0x394c5d0244b49e1eed533cd3505583e504589157",
  liquidityLocker: "0x857f7d11474235d8cafd79826d4d2e0d2b7dabd7",
  startBlock: 48678791n,
  scope: `${chainId}:direct:0x394c5d0244b49e1eed533cd3505583e504589157:48678791`,
  dexVersion: "v4"
};

export const directDeployments = Array.from(new Map(
  [legacyCurrentDirectDeployment, configuredDirectDeployment, vNextDirectDeployment]
    .filter((deployment): deployment is DirectIndexerDeployment => Boolean(deployment))
    .map((deployment) => [deployment.scope, deployment])
).values());

const nftFactory = (base
  ? process.env.NFT_COLLECTION_FACTORY || "0xd8cf5150a4d789cab4b03855d3ff536c78fd4b33"
  : undefined) as `0x${string}` | undefined;
const nftController = (base
  ? process.env.NFT_DROP_CONTROLLER || "0xf7fc2f208b936a5858f9ae7f7750147c8284a2c6"
  : undefined) as `0x${string}` | undefined;
const nftMarketplace = (base
  ? process.env.NFT_MARKETPLACE || "0x5be0b302e32031378fdbdea3e5bb3d487e345761"
  : undefined) as `0x${string}` | undefined;
const nftStartBlock = BigInt(base ? process.env.NFT_DEPLOYMENT_BLOCK || "48886053" : "0");
const nftPFPFactory = (base
  ? process.env.NFT_PFP_FACTORY || "0x022742905a07f4534f9794ceb8c42be23a1c6815"
  : undefined) as `0x${string}` | undefined;
const nftPFPMarketplace = (base
  ? process.env.NFT_PFP_MARKETPLACE || "0x8a777d7d590b658ab07b0aee90ccc51b79c2981d"
  : undefined) as `0x${string}` | undefined;
const nftPFPStartBlock = BigInt(base ? process.env.NFT_PFP_DEPLOYMENT_BLOCK || "48886056" : "0");
const nftOffers = (base
  ? process.env.NFT_OFFERS || "0xdfb2ae739446fc8ffc57793005e687ce695dda64"
  : undefined) as `0x${string}` | undefined;
const nftOffersStartBlock = BigInt(base ? process.env.NFT_OFFERS_DEPLOYMENT_BLOCK || "48886061" : "0");
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

export const nftDeployments = [nftDeployment]
  .filter((deployment): deployment is NFTIndexerDeployment => Boolean(deployment));

export const chainDefinition = defineChain({
  id: chainId,
  name: stable ? "Stable" : monad ? "Monad" : robinhood ? "Robinhood Chain" : "Base",
  nativeCurrency: stable ? { name: "USDT0", symbol: "USDT0", decimals: 18 } : monad ? { name: "Monad", symbol: "MON", decimals: 18 } : { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: defaultRpcUrls } },
  blockExplorers: { default: { name: stable ? "Stablescan" : monad ? "MonadVision" : robinhood ? "Robinhood Explorer" : "BaseScan", url: stable ? "https://stablescan.xyz" : monad ? "https://monadvision.com" : robinhood ? "https://robinhoodchain.blockscout.com" : "https://basescan.org" } },
  contracts: !base ? undefined : {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 5022
    }
  }
});

export const poolManager = robinhood
  ? "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const
  : monad ? "0x188d586ddcf52439676ca21a244753fa19f9ea8e" as const
  : "0x498581ff718922c3f8e6a244956af099b2652b2b" as const;

export const stableQuoteToken = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;

export function deploymentScope() {
  if (!mainnetDeployment?.launchFactory || !mainnetDeployment.bondingCurveMarket || mainnetDeployment.startBlock === 0n) return "";
  return `${chainId}:${mainnetDeployment.launchFactory.toLowerCase()}:${mainnetDeployment.bondingCurveMarket.toLowerCase()}:${mainnetDeployment.startBlock.toString()}`;
}

export function scopeForDeployment(deployment: IndexerDeployment) {
  return `${chainId}:${deployment.launchFactory.toLowerCase()}:${deployment.bondingCurveMarket.toLowerCase()}:${deployment.startBlock.toString()}`;
}

function splitRpcUrls(value?: string) {
  return (value || "").split(",").map((url) => url.trim()).filter(Boolean);
}

function configuredMonadBondDeployment(): IndexerDeployment | undefined {
  const launchFactory = (process.env.BOND_LAUNCH_FACTORY || "0x857430A20C3A5087e8f4f292B1573507567fa9cB") as `0x${string}`;
  const bondingCurveMarket = (process.env.BONDING_CURVE_MARKET || "0xB2a827Da4Bd935902baE6B5640d6384C2ef53821") as `0x${string}`;
  const graduationManager = (process.env.GRADUATION_MANAGER || "0xac03C2d754654015Cc6839625FAa883BB92959f2") as `0x${string}`;
  const liquidityLocker = (process.env.BOND_LIQUIDITY_LOCKER || "0x0488E96d545A977672aA75EF374a385d054AF2cb") as `0x${string}`;
  const feeHook = (process.env.FEE_HOOK || "0x65aAA8A131B4d4ed7f95C1F88740daeE4e1B20cc") as `0x${string}`;
  const startBlock = BigInt(process.env.BOND_DEPLOYMENT_BLOCK || "89311403");
  if (!launchFactory || !bondingCurveMarket || !graduationManager || !liquidityLocker || !feeHook || startBlock === 0n) return undefined;
  return { version: "vnext", launchFactory, bondingCurveMarket, graduationManager, liquidityLocker, feeHook, startBlock };
}
