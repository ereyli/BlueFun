import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";

export const chain = baseChain;

export type ContractDeployment = {
  version: "legacy" | "current";
  launchFactory: `0x${string}`;
  bondingCurveMarket: `0x${string}`;
  graduationManager: `0x${string}`;
  liquidityLocker: `0x${string}`;
  deploymentBlock: bigint;
  firstLaunchId: bigint;
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

const MAINNET_DEPLOYMENT: ContractDeployment = {
  version: "current",
  launchFactory: "0x29ce28c9cb3f584eb2548883824acd49881e780a",
  bondingCurveMarket: "0x94d056be6573bcaa4958cceeb242c3c08eff2b95",
  graduationManager: "0xa2b7626f6a92b366e6e787ac4db4840f57f253af",
  liquidityLocker: "0xe309983df86803f62e10d07d9522af005ec08ee4",
  deploymentBlock: 48451170n,
  firstLaunchId: 22n
};

export const addresses = {
  launchFactory: MAINNET_DEPLOYMENT.launchFactory,
  bondingCurveMarket: MAINNET_DEPLOYMENT.bondingCurveMarket,
  graduationManager: MAINNET_DEPLOYMENT.graduationManager,
  liquidityLocker: MAINNET_DEPLOYMENT.liquidityLocker,
  activationRegistry: "0x8453000000000000000000000000000000000001" as `0x${string}`,
  deploymentBlock: MAINNET_DEPLOYMENT.deploymentBlock
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

export const robinhoodAddresses: ContractDeployment = {
  version: "current",
  launchFactory: "0x128a32ed2af1787a3fab261bc6158400e2f649c9",
  bondingCurveMarket: "0x795fe5649a78496f51c1594a7b435941fb20adb8",
  graduationManager: "0x55d343fc936463c97b7e89dc0ac08c20a08bfb2a",
  liquidityLocker: "0x2176cbc6cb7e650289fe2ec4417b7a27fd0354d5",
  deploymentBlock: 6131828n,
  firstLaunchId: 1n
};

export const legacyBaseAddresses = LEGACY_BASE_DEPLOYMENT;
export const legacyRobinhoodAddresses = LEGACY_ROBINHOOD_DEPLOYMENT;

export function deploymentsForChain(chainId: number | undefined): ContractDeployment[] {
  const catalog = chainId === robinhoodChain.id
    ? [LEGACY_ROBINHOOD_DEPLOYMENT, robinhoodAddresses]
    : [LEGACY_BASE_DEPLOYMENT, MAINNET_DEPLOYMENT];
  return Array.from(new Map(catalog.map((deployment) => [deployment.bondingCurveMarket, deployment])).values());
}

export function deploymentForLaunch(chainId: number | undefined, launchId: string | bigint) {
  const id = typeof launchId === "bigint" ? launchId : BigInt(launchId);
  return deploymentsForChain(chainId)
    .filter((deployment) => deployment.firstLaunchId <= id)
    .sort((a, b) => {
      if (a.firstLaunchId !== b.firstLaunchId) return a.firstLaunchId > b.firstLaunchId ? -1 : 1;
      return a.version === "current" ? -1 : 1;
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
  return deploymentsForChain(resolvedChainId).map((deployment) => ({
    scope: indexerScopeForDeployment(resolvedChainId, deployment),
    deployment
  }));
}

export function indexerScopeForLaunch(chainId: number | undefined, launchId: string | bigint) {
  const resolvedChainId = chainId === robinhoodChain.id ? robinhoodChain.id : baseChain.id;
  return indexerScopeForDeployment(resolvedChainId, deploymentForLaunch(resolvedChainId, launchId));
}

export const FAIR_GRADUATION_TARGET_ETH = "5";
export const FAIR_LAUNCH_FEE_ETH = "0.002";

export const uniswapV4Addresses = {
  poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b" as `0x${string}`,
  positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc" as `0x${string}`,
  quoter: "0x0d5e0f971ed27fbff6c2837bf31316121532048d" as `0x${string}`,
  stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71" as `0x${string}`,
  universalRouter: "0x6ff5693b99212da76ad316178a184ab56d299b43" as `0x${string}`,
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3" as `0x${string}`
};

export const BLUEFUN_V4_POOL_FEE = 3000;
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
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ name: "token", type: "address" }]
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
