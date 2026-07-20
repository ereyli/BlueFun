import { zeroAddress } from "viem";

const address = (value?: string) => (value && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : zeroAddress) as `0x${string}`;

export const nftAddresses = {
  feePolicy: address(process.env.NEXT_PUBLIC_NFT_FEE_POLICY || "0xc982023f393626309e13b7b75d988c273a9f7786"),
  dropController: address(process.env.NEXT_PUBLIC_NFT_DROP_CONTROLLER || "0xf7fc2f208b936a5858f9ae7f7750147c8284a2c6"),
  collectionFactory: address(process.env.NEXT_PUBLIC_NFT_COLLECTION_FACTORY || "0xd8cf5150a4d789cab4b03855d3ff536c78fd4b33"),
  marketplace: address(process.env.NEXT_PUBLIC_NFT_MARKETPLACE || "0x5be0b302e32031378fdbdea3e5bb3d487e345761"),
  pfpFactory: address(process.env.NEXT_PUBLIC_NFT_PFP_FACTORY || "0x022742905a07f4534f9794ceb8c42be23a1c6815"),
  pfpMarketplace: address(process.env.NEXT_PUBLIC_NFT_PFP_MARKETPLACE || "0x8a777d7d590b658ab07b0aee90ccc51b79c2981d"),
  offers: address(process.env.NEXT_PUBLIC_NFT_OFFERS || "0xdfb2ae739446fc8ffc57793005e687ce695dda64"),
  weth: address(process.env.NEXT_PUBLIC_BASE_WETH || "0x4200000000000000000000000000000000000006"),
  deploymentBlock: BigInt(process.env.NEXT_PUBLIC_NFT_DEPLOYMENT_BLOCK || "48886053")
};
export type NFTDeployment = "current";

export function nftDeploymentForFactory(factory?: string): NFTDeployment {
  void factory;
  return "current";
}

export function nftControllerForDeployment(deployment: NFTDeployment) {
  void deployment;
  return nftAddresses.dropController;
}

export function nftMarketplaceForDeployment(_deployment: NFTDeployment, standard: "ERC721" | "ERC1155") {
  return standard === "ERC721" ? nftAddresses.pfpMarketplace : nftAddresses.marketplace;
}

export function isKnownNFTMarketplace(value: string, standard: "ERC721" | "ERC1155") {
  const expected = standard === "ERC721" ? nftAddresses.pfpMarketplace : nftAddresses.marketplace;
  return expected.toLowerCase() === value.toLowerCase();
}

export const nftLaunchpadEnabled = nftAddresses.feePolicy !== zeroAddress
  && nftAddresses.dropController !== zeroAddress
  && nftAddresses.collectionFactory !== zeroAddress
  && nftAddresses.marketplace !== zeroAddress;

export const pfpLaunchpadEnabled = nftLaunchpadEnabled
  && nftAddresses.pfpFactory !== zeroAddress
  && nftAddresses.pfpMarketplace !== zeroAddress;

export const nftOffersEnabled = pfpLaunchpadEnabled && nftAddresses.offers !== zeroAddress && nftAddresses.weth !== zeroAddress;
export const nftProtocolVersion = "v4" as const;

export const nftFeePolicyAbi = [
  { type: "function", name: "collectionLaunchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "primaryMintFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "marketplaceFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] }
] as const;

export const nftCollectionFactoryAbi = [
  { type: "function", name: "isBlueFunCollection", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "collectionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collections", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  {
    type: "function", name: "createCollection", stateMutability: "payable",
    inputs: [{ name: "params", type: "tuple", components: [
      { name: "name", type: "string" }, { name: "symbol", type: "string" },
      { name: "contractURI", type: "string" }, { name: "initialItemURI", type: "string" },
      { name: "initialMaxSupply", type: "uint256" }, { name: "initialCreatorReserve", type: "uint256" }, { name: "royaltyRecipient", type: "address" },
      { name: "royaltyBps", type: "uint16" }, { name: "salt", type: "bytes32" }
    ] }], outputs: [{ name: "collectionId", type: "uint256" }, { name: "collection", type: "address" }]
  },
  {
    type: "event", name: "NFTCollectionCreated", inputs: [
      { indexed: true, name: "collectionId", type: "uint256" }, { indexed: true, name: "collection", type: "address" },
      { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "symbol", type: "string" }, { indexed: false, name: "contractURI", type: "string" },
      { indexed: false, name: "initialTokenId", type: "uint256" }, { indexed: false, name: "initialItemURI", type: "string" },
      { indexed: false, name: "initialMaxSupply", type: "uint256" }, { indexed: false, name: "royaltyBps", type: "uint16" }
    ]
  }
] as const;

export const nftPFPFactoryAbi = [
  { type: "function", name: "isBlueFunCollection", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "collectionCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collections", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "createPFPCollection", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [
    { name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "contractURI", type: "string" },
    { name: "baseURI", type: "string" }, { name: "placeholderURI", type: "string" }, { name: "maxSupply", type: "uint256" },
    { name: "provenanceHash", type: "bytes32" }, { name: "revealed", type: "bool" },
    { name: "creatorReserve", type: "uint256" }, { name: "revealTime", type: "uint64" }, { name: "freezeOnReveal", type: "bool" },
    { name: "royaltyRecipient", type: "address" }, { name: "royaltyBps", type: "uint16" }, { name: "salt", type: "bytes32" }
  ] }], outputs: [{ name: "collectionId", type: "uint256" }, { name: "collection", type: "address" }] },
  { type: "event", name: "PFPCollectionCreated", inputs: [
    { indexed: true, name: "collectionId", type: "uint256" }, { indexed: true, name: "collection", type: "address" },
    { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "name", type: "string" },
    { indexed: false, name: "symbol", type: "string" }, { indexed: false, name: "contractURI", type: "string" },
    { indexed: false, name: "maxSupply", type: "uint256" }, { indexed: false, name: "provenanceHash", type: "bytes32" },
    { indexed: false, name: "revealed", type: "bool" }, { indexed: false, name: "royaltyBps", type: "uint16" }
  ] }
] as const;

export const bluePFPAbi = [
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "payoutRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "contractMetadataFrozen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "royaltyRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "royaltyBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "royaltyInfo", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "royaltyFrozen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "collectionMaxSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalLifetimeMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "revealed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "metadataFrozen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "placeholderURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "baseURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "provenanceHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "creatorReserveRemaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "scheduledRevealTime", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getApproved", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "reveal", stateMutability: "nonpayable", inputs: [{ type: "string" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "scheduleReveal", stateMutability: "nonpayable", inputs: [{ type: "string" }, { type: "uint64" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "cancelScheduledReveal", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "executeScheduledReveal", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "airdrop", stateMutability: "nonpayable", inputs: [{ type: "address[]" }, { type: "uint256[]" }], outputs: [] },
  { type: "function", name: "releaseCreatorReserve", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "proposeOwner", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "acceptOwner", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setPayoutRecipient", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "setMintController", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "setPlaceholderURI", stateMutability: "nonpayable", inputs: [{ type: "string" }], outputs: [] },
  { type: "function", name: "setBaseURI", stateMutability: "nonpayable", inputs: [{ type: "string" }], outputs: [] },
  { type: "function", name: "setProvenanceHash", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "setContractURI", stateMutability: "nonpayable", inputs: [{ type: "string" }], outputs: [] },
  { type: "function", name: "freezeContractMetadata", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setRoyalty", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "freezeRoyalty", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setTransferValidator", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "freezeMetadata", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }
] as const;

export const bluePFPV3RevealAbi = [
  { type: "function", name: "scheduleReveal", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint64" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "executeScheduledReveal", stateMutability: "nonpayable", inputs: [{ type: "string" }, { type: "bytes32" }], outputs: [] }
] as const;

export const nftPFPMarketplaceAbi = [
  { type: "function", name: "listingCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "createListing", stateMutability: "nonpayable", inputs: [
    { type: "address" }, { type: "uint256" }, { type: "uint128" }, { type: "uint64" }, { type: "uint64" }
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "listings", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "seller", type: "address" }, { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "price", type: "uint128" }, { name: "startTime", type: "uint64" }, { name: "endTime", type: "uint64" },
    { name: "cancelled", type: "bool" }, { name: "sold", type: "bool" }
  ] },
  { type: "function", name: "cancelListing", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [] },
] as const;

const phaseComponents = [
  { name: "phaseType", type: "uint8" }, { name: "limitMode", type: "uint8" }, { name: "currency", type: "address" },
  { name: "mintPrice", type: "uint128" }, { name: "startTime", type: "uint64" }, { name: "endTime", type: "uint64" },
  { name: "phaseSupplyCap", type: "uint64" }, { name: "defaultWalletLimit", type: "uint32" },
  { name: "maxPerTransaction", type: "uint32" }, { name: "merkleRoot", type: "bytes32" }
] as const;

export const nftDropControllerAbi = [
  { type: "function", name: "createPhase", stateMutability: "nonpayable", inputs: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "config", type: "tuple", components: phaseComponents }
  ], outputs: [{ name: "phaseId", type: "uint256" }] },
  { type: "function", name: "updatePhase", stateMutability: "nonpayable", inputs: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "phaseId", type: "uint256" },
    { name: "config", type: "tuple", components: phaseComponents }
  ], outputs: [] },
  { type: "function", name: "cancelPhase", stateMutability: "nonpayable", inputs: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "phaseId", type: "uint256" }
  ], outputs: [] },
  { type: "function", name: "latestPhaseId", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "phases", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [
    ...phaseComponents, { name: "previousPhaseEnd", type: "uint64" }, { name: "cancelled", type: "bool" }
  ] },
  { type: "function", name: "phaseMinted", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mintedByWalletInPhase", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mintedByWalletTotal", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mintPublic", stateMutability: "payable", inputs: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "phaseId", type: "uint256" },
    { name: "quantity", type: "uint256" }, { name: "recipient", type: "address" },
    { name: "expectedUnitPrice", type: "uint256" }, { name: "deadline", type: "uint256" }
  ], outputs: [] },
  { type: "function", name: "mintAllowlist", stateMutability: "payable", inputs: [
    { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "phaseId", type: "uint256" },
    { name: "quantity", type: "uint256" }, { name: "recipient", type: "address" }, { name: "walletAllowance", type: "uint256" },
    { name: "allowlistUnitPrice", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "proof", type: "bytes32[]" }
  ], outputs: [] }
] as const;

export const blueEditionAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "payoutRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "contractURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "contractMetadataFrozen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "royaltyRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "royaltyBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "royaltyInfo", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "royaltyFrozen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "totalLifetimeMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nextTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "createItem", stateMutability: "nonpayable", inputs: [{ type: "string" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "createItemWithReserve", stateMutability: "nonpayable", inputs: [{ type: "string" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creatorReserveRemaining", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenMetadataFrozen", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "airdrop", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }], outputs: [] },
  { type: "function", name: "releaseCreatorReserve", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "proposeOwner", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "acceptOwner", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setPayoutRecipient", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "setMintController", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "setMaxSupply", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "setTokenURI", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "string" }], outputs: [] },
  { type: "function", name: "freezeTokenMetadata", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "setContractURI", stateMutability: "nonpayable", inputs: [{ type: "string" }], outputs: [] },
  { type: "function", name: "freezeContractMetadata", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setRoyalty", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint16" }], outputs: [] },
  { type: "function", name: "freezeRoyalty", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setTransferValidator", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "uri", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lifetimeMinted", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] }
] as const;

export const nftMarketplaceAbi = [
  { type: "function", name: "listingCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "createListing", stateMutability: "nonpayable", inputs: [
    { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "uint128" }, { type: "uint64" }, { type: "uint64" }
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "listings", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "seller", type: "address" }, { name: "collection", type: "address" }, { name: "tokenId", type: "uint256" },
    { name: "unitPrice", type: "uint128" }, { name: "startTime", type: "uint64" }, { name: "endTime", type: "uint64" },
    { name: "remainingQuantity", type: "uint64" }, { name: "cancelled", type: "bool" }
  ] },
  { type: "function", name: "cancelListing", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "uint64" }, { type: "address" }], outputs: [] },
] as const;

export const nftOfferComponents = [
  { name: "maker", type: "address" }, { name: "taker", type: "address" },
  { name: "recipient", type: "address" }, { name: "collection", type: "address" },
  { name: "tokenId", type: "uint256" }, { name: "unitPrice", type: "uint128" },
  { name: "quantity", type: "uint64" }, { name: "startTime", type: "uint64" },
  { name: "endTime", type: "uint64" }, { name: "nonce", type: "uint256" },
  { name: "standard", type: "uint8" }, { name: "offerType", type: "uint8" }
] as const;

export const nftOffersAbi = [
  { type: "function", name: "feePolicy", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "hashOffer", stateMutability: "view", inputs: [{ name: "offer", type: "tuple", components: nftOfferComponents }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "filledQuantity", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "minimumNonce", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "acceptOffer", stateMutability: "nonpayable", inputs: [{ name: "offer", type: "tuple", components: nftOfferComponents }, { name: "tokenId", type: "uint256" }, { name: "quantity", type: "uint64" }, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "function", name: "acceptOfferWithMinProceeds", stateMutability: "nonpayable", inputs: [{ name: "offer", type: "tuple", components: nftOfferComponents }, { name: "tokenId", type: "uint256" }, { name: "quantity", type: "uint64" }, { name: "signature", type: "bytes" }, { name: "minimumSellerProceeds", type: "uint256" }], outputs: [] },
  { type: "function", name: "isOfferExecutable", stateMutability: "view", inputs: [{ name: "offer", type: "tuple", components: nftOfferComponents }, { name: "signature", type: "bytes" }, { name: "quantity", type: "uint64" }], outputs: [{ name: "executable", type: "bool" }, { name: "requiredAmount", type: "uint256" }, { name: "balance", type: "uint256" }, { name: "allowance", type: "uint256" }] },
  { type: "function", name: "cancelOffer", stateMutability: "nonpayable", inputs: [{ name: "offer", type: "tuple", components: nftOfferComponents }], outputs: [] },
  { type: "function", name: "cancelAllOffers", stateMutability: "nonpayable", inputs: [{ name: "newMinimumNonce", type: "uint256" }], outputs: [] }
] as const;

export const wethOffersAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] }
] as const;

export function ipfsGateway(uri?: string) {
  return uri?.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}` : uri || "";
}
