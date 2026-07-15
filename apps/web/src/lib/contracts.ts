import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";

export const chain = baseChain;

export const blueStakingAddresses = {
  token: "0xb200000000000000000000Af2d07754b927109bc" as `0x${string}`,
  governance: (process.env.NEXT_PUBLIC_BLUE_STAKING_GOVERNANCE
    || "0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26") as `0x${string}`,
  revenueRouter: (process.env.NEXT_PUBLIC_BLUE_REVENUE_ROUTER
    || "0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741") as `0x${string}`,
  vault: (process.env.NEXT_PUBLIC_BLUE_STAKING_VAULT
    || "0x221a86096a334BcaFd5E561564dC8E6A48F19584") as `0x${string}`,
  deploymentBlock: BigInt(process.env.NEXT_PUBLIC_BLUE_STAKING_DEPLOYMENT_BLOCK || "48678791")
};

export type ContractDeployment = {
  version: "legacy" | "fee-sharing-v1" | "current" | "vnext";
  launchFactory: `0x${string}`;
  bondingCurveMarket: `0x${string}`;
  graduationManager: `0x${string}`;
  liquidityLocker: `0x${string}`;
  deploymentBlock: bigint;
  firstLaunchId: bigint;
  directLaunchFactory?: `0x${string}`;
  directLiquidityLocker?: `0x${string}`;
  directDeploymentBlock?: bigint;
  feeHook?: `0x${string}`;
};

const LEGACY_BASE_DEPLOYMENT: ContractDeployment = {
  version: "legacy",
  launchFactory: "0xf65ebfdacb1a8e0a8217185aae44f489e53b88f9" as `0x${string}`,
  bondingCurveMarket: "0x4ce2154146eacf745133d7755875767d6a00ee5f" as `0x${string}`,
  graduationManager: "0x0a5769b0c8bff62e2c50014cb76f5cb4fde849c2" as `0x${string}`,
  liquidityLocker: "0x63e79af2821238a5a20716f710c4a9401e64141d" as `0x${string}`,
  deploymentBlock: 48379352n,
  firstLaunchId: 1n
};

const FEE_SHARING_BASE_DEPLOYMENT: ContractDeployment = {
  version: "fee-sharing-v1",
  launchFactory: "0x29ce28c9cb3f584eb2548883824acd49881e780a",
  bondingCurveMarket: "0x94d056be6573bcaa4958cceeb242c3c08eff2b95",
  graduationManager: "0xa2b7626f6a92b366e6e787ac4db4840f57f253af",
  liquidityLocker: "0xe309983df86803f62e10d07d9522af005ec08ee4",
  deploymentBlock: 48451170n,
  firstLaunchId: 22n
};

const MAINNET_DEPLOYMENT: ContractDeployment = {
  version: "current",
  launchFactory: "0x830569db6364f22cfb5eaa8a0ce17b1382ed3436",
  bondingCurveMarket: "0xb503b0ef06ec10554f4d960e08869877a41498dd",
  graduationManager: "0x250aec1fdffbe663e1fe9bd292529745cabb68ab",
  liquidityLocker: "0x48aa4cb0efb545bc9ccc07dcb380dfb4ab8ab4d5",
  deploymentBlock: 48642000n,
  firstLaunchId: 23n,
  directLaunchFactory: "0x0246688cef66734c1cada909cfd202e1448ba275",
  directLiquidityLocker: "0x2e83029d88d0af58ba55b31980dc709920fab941",
  directDeploymentBlock: 48647525n
};

const VNEXT_BASE_DEPLOYMENT: ContractDeployment = {
  version: "vnext",
  launchFactory: "0x820344fb4c0a518d0caef5d3de96ff41cbe6b345",
  bondingCurveMarket: "0x7d42dd1435e9567c1edfb513c45c8ea82fe03a38",
  graduationManager: "0x989bd9259408f73bb17099d37df2ccdc57b271f3",
  liquidityLocker: "0x484345c0fc777d1945a84adb6284d487dafb1de8",
  deploymentBlock: 48678791n,
  firstLaunchId: 23n,
  directLaunchFactory: (process.env.NEXT_PUBLIC_BASE_DIRECT_LAUNCH_FACTORY
    || "0x394c5d0244b49e1eed533cd3505583e504589157") as `0x${string}`,
  directLiquidityLocker: (process.env.NEXT_PUBLIC_BASE_DIRECT_LIQUIDITY_LOCKER
    || "0x857f7d11474235d8cafd79826d4d2e0d2b7dabd7") as `0x${string}`,
  directDeploymentBlock: BigInt(process.env.NEXT_PUBLIC_BASE_DIRECT_DEPLOYMENT_BLOCK || "48678791"),
  feeHook: "0xf0b8dde19510ee7d6d50be289c4257ecd14c60cc"
};

export const addresses = {
  version: VNEXT_BASE_DEPLOYMENT.version,
  launchFactory: VNEXT_BASE_DEPLOYMENT.launchFactory,
  bondingCurveMarket: VNEXT_BASE_DEPLOYMENT.bondingCurveMarket,
  graduationManager: VNEXT_BASE_DEPLOYMENT.graduationManager,
  liquidityLocker: VNEXT_BASE_DEPLOYMENT.liquidityLocker,
  directLaunchFactory: VNEXT_BASE_DEPLOYMENT.directLaunchFactory,
  directLiquidityLocker: VNEXT_BASE_DEPLOYMENT.directLiquidityLocker,
  directDeploymentBlock: VNEXT_BASE_DEPLOYMENT.directDeploymentBlock,
  activationRegistry: "0x8453000000000000000000000000000000000001" as `0x${string}`,
  deploymentBlock: VNEXT_BASE_DEPLOYMENT.deploymentBlock,
  firstLaunchId: VNEXT_BASE_DEPLOYMENT.firstLaunchId
};

const LEGACY_ROBINHOOD_DEPLOYMENT: ContractDeployment = {
  version: "legacy",
  launchFactory: "0x6a05304638bed7c96b78f420c612e84111fad4d1" as `0x${string}`,
  bondingCurveMarket: "0xab7597fecaf3357101a3a4331f512031ef3238f0" as `0x${string}`,
  graduationManager: "0xf6545a701a8cbe80d573043e8ffb8210de913d28" as `0x${string}`,
  liquidityLocker: "0x2d1e48fb40f00ed48f2e16df4a7a587fd063d177" as `0x${string}`,
  deploymentBlock: 5576234n,
  firstLaunchId: 1n
};

const FEE_SHARING_ROBINHOOD_DEPLOYMENT: ContractDeployment = {
  version: "fee-sharing-v1",
  launchFactory: "0x128a32ed2af1787a3fab261bc6158400e2f649c9",
  bondingCurveMarket: "0x795fe5649a78496f51c1594a7b435941fb20adb8",
  graduationManager: "0x55d343fc936463c97b7e89dc0ac08c20a08bfb2a",
  liquidityLocker: "0x2176cbc6cb7e650289fe2ec4417b7a27fd0354d5",
  deploymentBlock: 6131828n,
  firstLaunchId: 1n
};

export const robinhoodAddresses: ContractDeployment = {
  version: "current",
  launchFactory: "0xb880ea1d3453968243722b9c1529870c796b060f",
  bondingCurveMarket: "0x2d6d77652facbbcae05c0dc3aed792b94cd61fa8",
  graduationManager: "0xeb3e83ab91bd44959ace28b5f1cccb79b4b4092d",
  liquidityLocker: "0x6e77d6418b9065cc947dba95bd1cbba3ca881318",
  deploymentBlock: 9943107n,
  firstLaunchId: 2n,
  directLaunchFactory: (process.env.NEXT_PUBLIC_ROBINHOOD_DIRECT_LAUNCH_FACTORY
    || "0x9d0e5d76ca2d79ca6ab0c800763eb8e5c39a5079") as `0x${string}`,
  directLiquidityLocker: (process.env.NEXT_PUBLIC_ROBINHOOD_DIRECT_LIQUIDITY_LOCKER
    || "0xe0158cb5c659e95e0ef461e1f7518c4f3b557e81") as `0x${string}`,
  directDeploymentBlock: BigInt(process.env.NEXT_PUBLIC_ROBINHOOD_DIRECT_DEPLOYMENT_BLOCK || "10283960")
};

export const legacyBaseAddresses = LEGACY_BASE_DEPLOYMENT;
export const legacyRobinhoodAddresses = LEGACY_ROBINHOOD_DEPLOYMENT;

export function deploymentsForChain(chainId: number | undefined): ContractDeployment[] {
  const catalog = chainId === robinhoodChain.id
    ? [LEGACY_ROBINHOOD_DEPLOYMENT, FEE_SHARING_ROBINHOOD_DEPLOYMENT, robinhoodAddresses]
    : [LEGACY_BASE_DEPLOYMENT, FEE_SHARING_BASE_DEPLOYMENT, MAINNET_DEPLOYMENT, VNEXT_BASE_DEPLOYMENT];
  return Array.from(new Map(catalog.map((deployment) => [deployment.bondingCurveMarket, deployment])).values());
}

function directDeploymentsForChain(chainId: number): ContractDeployment[] {
  return chainId === robinhoodChain.id
    ? [robinhoodAddresses]
    : [MAINNET_DEPLOYMENT, VNEXT_BASE_DEPLOYMENT];
}

export function deploymentForLaunch(chainId: number | undefined, launchId: string | bigint) {
  const id = typeof launchId === "bigint" ? launchId : BigInt(launchId);
  return deploymentsForChain(chainId)
    .filter((deployment) => deployment.firstLaunchId <= id)
    .sort((a, b) => {
      if (a.firstLaunchId !== b.firstLaunchId) return a.firstLaunchId > b.firstLaunchId ? -1 : 1;
      const rank = { legacy: 0, "fee-sharing-v1": 1, current: 2, vnext: 3 } as const;
      return rank[b.version] - rank[a.version];
    })[0];
}

export const robinhoodUniswapV4Addresses = {
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951" as `0x${string}`,
  positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7" as `0x${string}`,
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as `0x${string}`,
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as `0x${string}`,
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904" as `0x${string}`,
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3" as `0x${string}`
};

export function contractsForChain(chainId: number | undefined) {
  if (chainId === robinhoodChain.id) {
    return {
      chain: robinhoodChain,
      addresses: robinhoodAddresses,
      uniswapV4Addresses: robinhoodUniswapV4Addresses,
      uniswapChainName: "robinhood"
    };
  }
  return { chain: baseChain, addresses, uniswapV4Addresses, uniswapChainName: "base" };
}

export function contractsForLaunch(chainId: number | undefined, launchId: string | bigint) {
  const config = contractsForChain(chainId);
  const deployment = deploymentForLaunch(chainId, launchId);
  return { ...config, addresses: deployment };
}

export function indexerScope() {
  if (!addresses.launchFactory || !addresses.bondingCurveMarket || addresses.deploymentBlock === 0n) return "";
  return `${chain.id}:${addresses.launchFactory.toLowerCase()}:${addresses.bondingCurveMarket.toLowerCase()}:${addresses.deploymentBlock.toString()}`;
}

export function indexerScopeForChain(chainId: number | undefined) {
  const config = contractsForChain(chainId);
  const deployment = config.addresses;
  if (!deployment.launchFactory || !deployment.bondingCurveMarket || deployment.deploymentBlock === 0n) return "";
  return `${config.chain.id}:${deployment.launchFactory.toLowerCase()}:${deployment.bondingCurveMarket.toLowerCase()}:${deployment.deploymentBlock.toString()}`;
}

export function indexerScopeForDeployment(chainId: number, deployment: ContractDeployment) {
  return `${chainId}:${deployment.launchFactory.toLowerCase()}:${deployment.bondingCurveMarket.toLowerCase()}:${deployment.deploymentBlock.toString()}`;
}

export function indexerScopesForChain(chainId: number | undefined) {
  const resolvedChainId = chainId === robinhoodChain.id ? robinhoodChain.id : baseChain.id;
  const contexts = deploymentsForChain(resolvedChainId).map((deployment) => ({
    scope: indexerScopeForDeployment(resolvedChainId, deployment),
    deployment
  }));
  for (const current of directDeploymentsForChain(resolvedChainId)) {
    if (!current.directLaunchFactory || !current.directDeploymentBlock || current.directDeploymentBlock === 0n) continue;
    contexts.push({
      scope: `${resolvedChainId}:direct:${current.directLaunchFactory.toLowerCase()}:${current.directDeploymentBlock.toString()}`,
      deployment: {
        ...current,
        launchFactory: current.directLaunchFactory,
        bondingCurveMarket: "0x0000000000000000000000000000000000000000",
        graduationManager: "0x0000000000000000000000000000000000000000",
        liquidityLocker: current.directLiquidityLocker ?? "0x0000000000000000000000000000000000000000",
        deploymentBlock: current.directDeploymentBlock,
        firstLaunchId: 1n
      }
    });
  }
  return contexts;
}

export function indexerScopeForLaunch(chainId: number | undefined, launchId: string | bigint) {
  const resolvedChainId = chainId === robinhoodChain.id ? robinhoodChain.id : baseChain.id;
  return indexerScopeForDeployment(resolvedChainId, deploymentForLaunch(resolvedChainId, launchId));
}

export function isVNextLiquidityLocker(chainId: number, locker?: string) {
  if (!locker || chainId !== baseChain.id) return false;
  const value = locker.toLowerCase();
  return value === VNEXT_BASE_DEPLOYMENT.liquidityLocker.toLowerCase()
    || value === VNEXT_BASE_DEPLOYMENT.directLiquidityLocker?.toLowerCase();
}

export const FAIR_GRADUATION_TARGET_ETH = "5";
export const FAIR_LAUNCH_FEE_ETH = "0.001";
export const DIRECT_LAUNCH_FEE_FALLBACK_ETH = "0.001";

export const uniswapV4Addresses = {
  poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b" as `0x${string}`,
  positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc" as `0x${string}`,
  quoter: "0x0d5e0f971ed27fbff6c2837bf31316121532048d" as `0x${string}`,
  stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71" as `0x${string}`,
  universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43" as `0x${string}`,
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3" as `0x${string}`
};

export const BLUEFUN_V4_POOL_FEE = 0x800000;
export const BLUEFUN_V4_TICK_SPACING = 60;

export const launchFactoryAbi = [
  {
    type: "event",
    name: "LaunchFeePaid",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "amount", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "LaunchCreated",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "symbol", type: "string" },
      { indexed: false, name: "contractURI", type: "string" }
    ]
  },
  {
    type: "function",
    name: "LAUNCH_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "pendingLaunchFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "claimLaunchFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "payable",
    inputs: [
      {
        name: "metadata",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "contractURI", type: "string" },
          { name: "salt", type: "bytes32" }
        ]
      },
      {
        name: "curve",
        type: "tuple",
        components: [
          { name: "virtualTokenReserve", type: "uint256" },
          { name: "virtualEthReserve", type: "uint256" },
          { name: "graduationEthTarget", type: "uint256" },
          { name: "maxSupply", type: "uint256" }
        ]
      },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "perWalletCap", type: "uint256" },
          { name: "creatorAllocation", type: "uint256" },
          { name: "platformFeeBps", type: "uint16" },
          { name: "creatorFeeBps", type: "uint16" },
          { name: "antiSnipingDuration", type: "uint64" },
          { name: "antiSnipingMaxBuy", type: "uint256" }
        ]
      }
    ],
    outputs: [
      { name: "launchId", type: "uint256" },
      { name: "token", type: "address" }
    ]
  },
  {
    type: "function",
    name: "predictTokenAddress",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "salt", type: "bytes32" }
    ],
    outputs: [{ name: "token", type: "address" }]
  }
] as const;

export const directLaunchFactoryAbi = [
  {
    type: "event",
    name: "DirectLaunchCreated",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "poolId", type: "bytes32" },
      { indexed: false, name: "positionId", type: "bytes32" },
      { indexed: false, name: "poolFee", type: "uint24" },
      { indexed: false, name: "tickSpacing", type: "int24" },
      { indexed: false, name: "platformShareBps", type: "uint16" },
      { indexed: false, name: "creatorShareBps", type: "uint16" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "symbol", type: "string" },
      { indexed: false, name: "contractURI", type: "string" }
    ]
  },
  {
    type: "function",
    name: "launchFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "launchConfig",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "poolFee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "initialSqrtPriceX96", type: "uint160" },
      { name: "platformShareBps", type: "uint16" },
      { name: "creatorShareBps", type: "uint16" }
    ]
  },
  {
    type: "function",
    name: "launchConfigHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }]
  },
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "payable",
    inputs: [
      {
        name: "metadata",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "contractURI", type: "string" },
          { name: "salt", type: "bytes32" }
        ]
      },
      { name: "expectedConfigHash", type: "bytes32" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [
      { name: "launchId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "poolId", type: "bytes32" },
      { name: "positionId", type: "bytes32" }
    ]
  },
  {
    type: "function",
    name: "createLaunchWithInitialBuy",
    stateMutability: "payable",
    inputs: [
      {
        name: "metadata",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "contractURI", type: "string" },
          { name: "salt", type: "bytes32" }
        ]
      },
      { name: "expectedConfigHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "minimumTokensOut", type: "uint256" }
    ],
    outputs: [
      { name: "launchId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "poolId", type: "bytes32" },
      { name: "positionId", type: "bytes32" }
    ]
  }
] as const;

export const bondingCurveAbi = [
  {
    type: "event",
    name: "TokensBought",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: false, name: "ethIn", type: "uint256" },
      { indexed: false, name: "tokensOut", type: "uint256" },
      { indexed: false, name: "platformFee", type: "uint256" },
      { indexed: false, name: "creatorFee", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "TokensSold",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "tokensIn", type: "uint256" },
      { indexed: false, name: "ethOut", type: "uint256" },
      { indexed: false, name: "platformFee", type: "uint256" },
      { indexed: false, name: "creatorFee", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "launchCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "launchId", type: "uint256" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "creator", type: "address" },
      { name: "virtualTokenReserve", type: "uint256" },
      { name: "virtualEthReserve", type: "uint256" },
      { name: "realEthReserve", type: "uint256" },
      { name: "grossEthRaised", type: "uint256" },
      { name: "graduationEthTarget", type: "uint256" },
      { name: "maxSupply", type: "uint256" },
      { name: "perWalletCap", type: "uint256" },
      { name: "creatorAllocation", type: "uint256" },
      { name: "platformFeeBps", type: "uint16" },
      { name: "creatorFeeBps", type: "uint16" },
      { name: "createdAt", type: "uint64" },
      { name: "antiSnipingDuration", type: "uint64" },
      { name: "antiSnipingMaxBuy", type: "uint256" },
      { name: "graduationReady", type: "bool" },
      { name: "graduated", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "launchId", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "tokensOut", type: "uint256" }]
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "launchId", type: "uint256" },
      { name: "tokenAmount", type: "uint256" },
      { name: "minEthOut", type: "uint256" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: [{ name: "ethOut", type: "uint256" }]
  },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [
      { name: "launchId", type: "uint256" },
      { name: "ethIn", type: "uint256" }
    ],
    outputs: [
      { name: "tokensOut", type: "uint256" },
      { name: "netEthIn", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [
      { name: "launchId", type: "uint256" },
      { name: "tokenAmount", type: "uint256" }
    ],
    outputs: [
      { name: "ethOut", type: "uint256" },
      { name: "grossEthOut", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "pendingFees",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    type: "function",
    name: "claimFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }]
  }
] as const;

export const b20TokenAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

export const activationRegistryAbi = [
  {
    type: "function",
    name: "isActivated",
    stateMutability: "view",
    inputs: [{ name: "feature", type: "bytes32" }],
    outputs: [{ name: "active", type: "bool" }]
  }
] as const;

export const graduationManagerAbi = [
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "positionId", type: "bytes32" }
    ]
  },
  {
    type: "function",
    name: "graduate",
    stateMutability: "nonpayable",
    inputs: [{ name: "launchId", type: "uint256" }],
    outputs: [{ name: "positionId", type: "bytes32" }]
  }
] as const;

export const feeSharingLockerAbi = [
  {
    type: "function",
    name: "feeRevenue",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [
      { name: "nativeCollected", type: "uint256" },
      { name: "tokenCollected", type: "uint256" },
      { name: "platformNative", type: "uint256" },
      { name: "platformToken", type: "uint256" },
      { name: "creatorNative", type: "uint256" },
      { name: "creatorToken", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "pendingFees",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "currency", type: "address" }
    ],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    type: "function",
    name: "collectFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [
      { name: "nativeAmount", type: "uint256" },
      { name: "tokenAmount", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "claimFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "currency", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }]
  }
] as const;

export const liquidityLockerPoolAbi = [
  {
    type: "function",
    name: "hooks",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "initializationGuard",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

export const unifiedFeeHookAbi = [
  {
    type: "function",
    name: "pendingCreatorRevenue",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    type: "function",
    name: "claimCreatorRevenue",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }]
  }
] as const;

export const universalRouterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: []
  }
] as const;

export const permit2Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" }
    ]
  }
] as const;

export const uniswapV4QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" }
    ]
  }
] as const;
