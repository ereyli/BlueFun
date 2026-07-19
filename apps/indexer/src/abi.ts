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
  }
] as const;

export const nftCollectionFactoryAbi = [
  {
    type: "event",
    name: "NFTCollectionCreated",
    inputs: [
      { indexed: true, name: "collectionId", type: "uint256" },
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "symbol", type: "string" },
      { indexed: false, name: "contractURI", type: "string" },
      { indexed: false, name: "initialTokenId", type: "uint256" },
      { indexed: false, name: "initialItemURI", type: "string" },
      { indexed: false, name: "initialMaxSupply", type: "uint256" },
      { indexed: false, name: "royaltyBps", type: "uint16" }
    ]
  }
] as const;

export const nftPFPFactoryAbi = [
  {
    type: "event", name: "PFPCollectionCreated", inputs: [
      { indexed: true, name: "collectionId", type: "uint256" },
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "symbol", type: "string" },
      { indexed: false, name: "contractURI", type: "string" },
      { indexed: false, name: "maxSupply", type: "uint256" },
      { indexed: false, name: "provenanceHash", type: "bytes32" },
      { indexed: false, name: "revealed", type: "bool" },
      { indexed: false, name: "royaltyBps", type: "uint16" }
    ]
  }
] as const;

export const nftPFPMarketplaceAbi = [
  { type: "event", name: "ListingCreated", inputs: [
    { indexed: true, name: "listingId", type: "uint256" }, { indexed: true, name: "seller", type: "address" },
    { indexed: true, name: "collection", type: "address" }, { indexed: false, name: "tokenId", type: "uint256" },
    { indexed: false, name: "price", type: "uint256" }, { indexed: false, name: "startTime", type: "uint64" }, { indexed: false, name: "endTime", type: "uint64" }
  ] },
  { type: "event", name: "ListingCancelled", inputs: [{ indexed: true, name: "listingId", type: "uint256" }, { indexed: true, name: "seller", type: "address" }] },
  { type: "event", name: "ListingPurchased", inputs: [
    { indexed: true, name: "listingId", type: "uint256" }, { indexed: true, name: "buyer", type: "address" },
    { indexed: true, name: "recipient", type: "address" }, { indexed: false, name: "grossAmount", type: "uint256" },
    { indexed: false, name: "platformFee", type: "uint256" }, { indexed: false, name: "royaltyRecipient", type: "address" },
    { indexed: false, name: "royaltyAmount", type: "uint256" }
  ] }
] as const;

const phaseTupleComponents = [
  { name: "phaseType", type: "uint8" },
  { name: "limitMode", type: "uint8" },
  { name: "currency", type: "address" },
  { name: "mintPrice", type: "uint128" },
  { name: "startTime", type: "uint64" },
  { name: "endTime", type: "uint64" },
  { name: "phaseSupplyCap", type: "uint64" },
  { name: "defaultWalletLimit", type: "uint32" },
  { name: "maxPerTransaction", type: "uint32" },
  { name: "merkleRoot", type: "bytes32" }
] as const;

export const nftDropControllerAbi = [
  {
    type: "event",
    name: "PhaseCreated",
    inputs: [
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "phaseId", type: "uint256" },
      { indexed: false, name: "config", type: "tuple", components: phaseTupleComponents }
    ]
  },
  {
    type: "event",
    name: "PhaseUpdated",
    inputs: [
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "phaseId", type: "uint256" },
      { indexed: false, name: "config", type: "tuple", components: phaseTupleComponents }
    ]
  },
  {
    type: "event",
    name: "PhaseCancelledEvent",
    inputs: [
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "phaseId", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "NFTMinted",
    inputs: [
      { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "phaseId", type: "uint256" },
      { indexed: false, name: "payer", type: "address" },
      { indexed: false, name: "recipient", type: "address" },
      { indexed: false, name: "quantity", type: "uint256" },
      { indexed: false, name: "unitPrice", type: "uint256" },
      { indexed: false, name: "grossAmount", type: "uint256" },
      { indexed: false, name: "platformFee", type: "uint256" }
    ]
  }
] as const;

export const blueEdition1155Abi = [
  {
    type: "event",
    name: "ItemCreated",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: false, name: "maxSupply", type: "uint256" },
      { indexed: false, name: "uri", type: "string" }
    ]
  },
  { type: "event", name: "TransferSingle", inputs: [
    { indexed: true, name: "operator", type: "address" }, { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" }, { indexed: false, name: "id", type: "uint256" },
    { indexed: false, name: "value", type: "uint256" }
  ] },
  { type: "event", name: "TransferBatch", inputs: [
    { indexed: true, name: "operator", type: "address" }, { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" }, { indexed: false, name: "ids", type: "uint256[]" },
    { indexed: false, name: "values", type: "uint256[]" }
  ] }
] as const;

export const bluePFP721Abi = [
  { type: "event", name: "Transfer", inputs: [
    { indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" },
    { indexed: true, name: "tokenId", type: "uint256" }
  ] }
] as const;

export const nftMarketplaceAbi = [
  {
    type: "event",
    name: "ListingCreated",
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: true, name: "collection", type: "address" },
      { indexed: false, name: "tokenId", type: "uint256" },
      { indexed: false, name: "quantity", type: "uint256" },
      { indexed: false, name: "unitPrice", type: "uint256" },
      { indexed: false, name: "startTime", type: "uint64" },
      { indexed: false, name: "endTime", type: "uint64" }
    ]
  },
  {
    type: "event",
    name: "ListingCancelled",
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "remainingQuantity", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "ListingPurchased",
    inputs: [
      { indexed: true, name: "listingId", type: "uint256" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "quantity", type: "uint256" },
      { indexed: false, name: "grossAmount", type: "uint256" },
      { indexed: false, name: "platformFee", type: "uint256" },
      { indexed: false, name: "royaltyRecipient", type: "address" },
      { indexed: false, name: "royaltyAmount", type: "uint256" }
    ]
  }
] as const;

export const nftOffersAbi = [
  { type: "event", name: "OfferCancelled", inputs: [
    { indexed: true, name: "offerHash", type: "bytes32" },
    { indexed: true, name: "maker", type: "address" },
    { indexed: false, name: "nonce", type: "uint256" }
  ] },
  { type: "event", name: "AllOffersCancelled", inputs: [
    { indexed: true, name: "maker", type: "address" },
    { indexed: false, name: "previousMinimumNonce", type: "uint256" },
    { indexed: false, name: "newMinimumNonce", type: "uint256" }
  ] },
  { type: "event", name: "OfferAccepted", inputs: [
    { indexed: true, name: "offerHash", type: "bytes32" },
    { indexed: true, name: "maker", type: "address" },
    { indexed: true, name: "seller", type: "address" },
    { indexed: false, name: "collection", type: "address" },
    { indexed: false, name: "tokenId", type: "uint256" },
    { indexed: false, name: "quantity", type: "uint256" },
    { indexed: false, name: "grossAmount", type: "uint256" },
    { indexed: false, name: "platformFee", type: "uint256" },
    { indexed: false, name: "royaltyRecipient", type: "address" },
    { indexed: false, name: "royaltyAmount", type: "uint256" },
    { indexed: false, name: "standard", type: "uint8" },
    { indexed: false, name: "offerType", type: "uint8" }
  ] }
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

export const poolManagerAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { indexed: true, name: "id", type: "bytes32" },
      { indexed: true, name: "sender", type: "address" },
      { indexed: false, name: "amount0", type: "int128" },
      { indexed: false, name: "amount1", type: "int128" },
      { indexed: false, name: "sqrtPriceX96", type: "uint160" },
      { indexed: false, name: "liquidity", type: "uint128" },
      { indexed: false, name: "tick", type: "int24" },
      { indexed: false, name: "fee", type: "uint24" }
    ]
  }
] as const;
