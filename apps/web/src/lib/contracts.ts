import { baseChain } from "@/lib/base-chain";

export const chain = baseChain;

const MAINNET_DEPLOYMENT = {
  launchFactory: "0xf65ebfdacb1a8e0a8217185aae44f489e53b88f9" as `0x${string}`,
  bondingCurveMarket: "0x4ce2154146eacf745133d7755875767d6a00ee5f" as `0x${string}`,
  graduationManager: "0x0a5769b0c8bff62e2c50014cb76f5cb4fde849c2" as `0x${string}`,
  deploymentBlock: 48379352n
};

export const addresses = {
  launchFactory: MAINNET_DEPLOYMENT.launchFactory,
  bondingCurveMarket: MAINNET_DEPLOYMENT.bondingCurveMarket,
  graduationManager: MAINNET_DEPLOYMENT.graduationManager,
  activationRegistry: "0x8453000000000000000000000000000000000001" as `0x${string}`,
  deploymentBlock: MAINNET_DEPLOYMENT.deploymentBlock
};

export function indexerScope() {
  if (!addresses.launchFactory || !addresses.bondingCurveMarket || addresses.deploymentBlock === 0n) return "";
  return `${chain.id}:${addresses.launchFactory.toLowerCase()}:${addresses.bondingCurveMarket.toLowerCase()}:${addresses.deploymentBlock.toString()}`;
}

export const FAIR_GRADUATION_TARGET_ETH = "5";
export const FAIR_LAUNCH_FEE_ETH = "0.002";

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
    type: "function",
    name: "graduate",
    stateMutability: "nonpayable",
    inputs: [{ name: "launchId", type: "uint256" }],
    outputs: [{ name: "positionId", type: "bytes32" }]
  }
] as const;
