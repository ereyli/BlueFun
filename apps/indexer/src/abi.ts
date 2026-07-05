export const launchFactoryAbi = [
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
  }
] as const;

export const marketAbi = [
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
  }
] as const;

export const graduationAbi = [
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { indexed: true, name: "launchId", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "positionId", type: "bytes32" }
    ]
  }
] as const;
