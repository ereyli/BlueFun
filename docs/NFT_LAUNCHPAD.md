# BlueFun NFT Launchpad

## ERC-721 PFP drops

BlueFun supports PFP drops as a parallel module rather than changing the deployed ERC-1155 edition contracts:

- `BluePFP721`: creator-owned sequential ERC-721 minting, ERC-2981 royalties, ERC-4906 metadata refresh events, provenance commitment, delayed or instant reveal, optional permanent metadata freeze, burn support, two-step ownership transfer and optional transfer validation.
- `NFTPFPFactory`: permissionless CREATE2 deployment using the existing configurable collection launch fee and the existing `BlueDropController`.
- `BlueNFTMarketplace721`: non-custodial fixed-price PFP listings using the existing marketplace fee policy and pull-payment accounting.

The creator studio accepts a folder or ZIP containing up to 10,000 PNG/JPG/GIF/WEBP assets plus one of:

- token-level JSON files (`1.json` … `N.json`);
- one JSON metadata array;
- one CSV with `token_id`, `name`, `description`, `image`, `external_url` and optional `trait:*` columns;
- no metadata, in which case standards-compatible records are generated automatically.

Media and normalized metadata are pinned as separate IPFS directories. Delayed reveal stores only the placeholder URI and provenance hash at deployment; the metadata base URI is published later by the creator. The generated reveal manifest must therefore be kept safely until reveal.

Status: deployed to Base mainnet on 2026-07-18 from block `48766938`. All four core contracts are source-verified on Blockscout. An independent external audit is still recommended before broad public promotion.

## Base mainnet deployment

- Platform wallet: `0x6d5C7C444d130554Ab195F1D64c3b6D054BF19F8`
- Fee policy: [`0x453d7086FAe834B573bf129C2D64Fb50ad0c4c2D`](https://base.blockscout.com/address/0x453d7086fae834b573bf129c2d64fb50ad0c4c2d)
- Drop controller: [`0xb129417fFc25b5A8e918Cb63E6f45a605905C0aC`](https://base.blockscout.com/address/0xb129417ffc25b5a8e918cb63e6f45a605905c0ac)
- Collection factory: [`0x342F90f22fBd5f7D680d3d84Ce121BDA995F6F4D`](https://base.blockscout.com/address/0x342f90f22fbd5f7d680d3d84ce121bda995f6f4d)
- Marketplace: [`0xf08f44AC84632c7E3dF2E63804fB8eECb4B346bb`](https://base.blockscout.com/address/0xf08f44ac84632c7e3df2e63804fb8eecb4b346bb)
- WETH offers: [`0x5BDb354b162dF83392cf852A86B31194C1d3906f`](https://base.blockscout.com/address/0x5bdb354b162df83392cf852a86b31194c1d3906f), deployed at block `48801786` and source-verified.

## Product rules

- Standard: creator-owned ERC-1155 editions. A dedicated ERC-721 1/1 path is intentionally excluded.
- Each collection starts with token ID 1 and the creator can add any number of later token IDs, each with its own image, metadata and lifetime supply cap.
- Collection launch fee: exactly `0.001 ETH`. The platform wallet may change it from zero through the immutable `0.01 ETH` ceiling.
- Free primary mint: no percentage mint fee.
- Paid primary mint: `2%` BlueFun fee and `98%` creator proceeds. The platform wallet can never raise this above the hardcoded `5%` ceiling.
- BlueFun secondary market: `0.8%` platform fee plus the creator's ERC-2981 royalty (maximum 10%).
- Signed offers: item and collection bids are denominated in canonical Base WETH. Signing is gasless and non-custodial; WETH moves atomically only when an owner accepts. The same `0.8%` secondary fee and ERC-2981 royalty rules apply.
- Mint access: public, Merkle allowlist, or allowlist followed by public. Each phase supports time bounds, phase supply cap, per-wallet limit, max per transaction and per-wallet allowlist price/allowance.
- Creator, royalty and seller revenue is pull-based. NFT platform revenue is sent directly to the deployment wallet; no separate revenue router is used.

The secondary fee tracks OpenSea's documented 1% NFT marketplace fee at a 20% discount. Primary mint intentionally uses a much lower 2% creator-friendly rate rather than tracking OpenSea's documented 10% primary-drop fee. OpenSea documents public/presale stages with price, duration and wallet limits. It also documents `contractURI`, `ContractURIUpdated`, and ERC-173 contract ownership for collection attribution.

References:

- https://docs.opensea.io/docs/part-4-edit-drop-settings
- https://docs.opensea.io/changelog/opensea-fee-update
- https://docs.opensea.io/docs/contract-level-metadata
- https://docs.opensea.io/docs/part-2-edit-collection-settings

## Contract boundaries

- `NFTFeePolicy`: bounded mutable fees, the rotatable platform revenue wallet, and independent collection, mint and marketplace pauses. The default deployment gives one wallet all three roles.
- `NFTCollectionFactory`: exact launch fee, CREATE2 deployment, factory registry and creator-owned collection creation.
- `BlueEdition1155`: balances, transfers, metadata, supply invariants, royalties, ownership and replaceable mint-controller authorization.
- `BlueDropController`: append-only non-overlapping public and allowlist phase schedules and primary revenue accounting.
- `BlueNFTMarketplace`: non-custodial fixed-price, partial-quantity ERC-1155 listings and secondary revenue accounting.
- `BlueNFTOffers`: separate EIP-712 WETH orderbook for ERC-721/1155 item and collection offers, partial ERC-1155 fills, multi-item ERC-721 collection fills, per-order cancellation, nonce-floor cancellation and EIP-1271 smart-account signatures.

The collection owner is the creator wallet, not BlueFun. Ownership transfer is two-step. The creator can update or permanently freeze token and contract metadata, lower supply after minting but never raise it after the first mint, lower royalties after minting but never raise them, freeze royalties, change payout address, and authorize a replacement mint controller without redeploying the collection.

Burning does not reopen mint supply: `lifetimeMinted <= maxSupply` is the permanent invariant.

## OpenSea behavior

The NFT contract exposes ERC-165, ERC-1155 metadata, ERC-2981, ERC-173 `owner`, `contractURI`, `ContractURIUpdated`, and OpenSea-compatible transfer-validator discovery. OpenSea can index and trade the tokens independently of BlueFun. ERC-173 attribution gives the creator the onchain ownership signal used by OpenSea; OpenSea account/collection claiming or UI settings may still require the creator to complete OpenSea's current verification flow.

BlueFun's marketplace and OpenSea are separate liquidity venues. A BlueFun listing does not automatically become a Seaport order. OpenSea listing integration can be added offchain later without changing the NFT, drop, fee-policy, or BlueFun marketplace contracts.

## WETH offer lifecycle

1. A collector wraps ETH into canonical Base WETH and grants the offers contract an allowance.
2. The wallet signs an EIP-712 item or collection offer. No asset enters BlueFun custody.
3. The indexed orderbook shows the bid on the collection, NFT detail and wallet dashboard views.
4. An eligible owner approves the offers contract and accepts. Seller proceeds, platform fee, royalty and NFT transfer settle atomically.
5. The maker may cancel one signed order or invalidate every older nonce. Expired, filled, cancelled, unfunded or unapproved offers cannot settle.

Canonical Base WETH is `0x4200000000000000000000000000000000000006`. The offers module is independent of collection bytecode, so adding or replacing the orderbook never requires creators to redeploy their NFTs.

## Creator self-service

The connected-wallet dashboard at `/nft/dashboard` is the operational control surface for both legacy and V2 collections:

- claim primary mint revenue from the collection's deployment-specific drop controller;
- claim seller proceeds and ERC-2981 royalties from all four Base fixed-price marketplaces;
- create, edit queued, or cancel queued/active public and allowlist mint phases;
- airdrop creator reserve and release unused reserve into public supply;
- update the primary payout wallet, royalty recipient/rate, contract metadata and two-step collection ownership;
- reveal PFP collections, update placeholders/base URI/provenance, schedule/cancel/execute reveal and permanently freeze metadata;
- add ERC-1155 editions, update item metadata, reduce lifetime supply after minting and freeze item metadata;
- explicitly authorize replacement mint controllers and transfer validators behind a warning and confirmation.

Transferred or pending owners can open an indexed BlueFun collection by contract address from the Created tab. This avoids depending on the immutable original `creator` index field when completing or operating a two-step ownership transfer. Irreversible freeze, ownership, validator, controller and phase-cancellation actions require an explicit in-app confirmation in addition to the wallet transaction confirmation.

WalletConnect is enabled only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is configured. Without it, the application deliberately falls back to installed browser wallets and Coinbase Wallet instead of initializing an invalid WalletConnect project.

## Deployment and activation checklist

1. Run `forge test`, `forge build --sizes`, the complete repository test suite, Slither, and a Base fork deployment simulation.
2. Independently audit supply accounting, Merkle leaf construction, receiver callbacks, payout accounting, royalty arithmetic, pause authority and CREATE2 address derivation.
3. Create a fresh platform/deployer wallet. This one wallet deploys the contracts, controls bounded fee and pause settings, and receives NFT platform revenue directly.
4. Simulate `DeployNFTLaunchpadBaseMainnet.s.sol` without `--broadcast`; record the platform wallet, addresses and bytecode hashes.
5. Broadcast only after sign-off, verify every source, then set the four web and four indexer deployment variables plus deployment block.
6. Apply `apps/indexer/migrations/20260717_nft_launchpad.sql`, start the Base indexer, and confirm collection, item, phase, mint, listing and sale checkpoints.
7. Smoke test a free mint, paid mint, allowlist mint, partial secondary sale, cancellation, claims, platform flush and all three pause paths with controlled wallets.

No proxy is used for collection balances or supply. Extensibility is isolated in replaceable controllers, mutable bounded policy and independent marketplace contracts, reducing upgrade trust while avoiding collection redeployment for future mint logic. The platform revenue address can be rotated from the policy without redeploying NFT collections. The simplified one-wallet administration is intentionally centralized; compromise of that key compromises NFT fee, pause and future platform-revenue administration, though it does not transfer creator ownership of collections.

The current internal pre-deployment review, resolved findings, residual risks and mandatory release gates are recorded in [`NFT_SECURITY_REVIEW.md`](NFT_SECURITY_REVIEW.md).
