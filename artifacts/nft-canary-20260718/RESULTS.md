# BlueFun NFT Mainnet Canary Results

Date: 2026-07-18
Network: Base mainnet (chain ID 8453)
Canary creator: `0xbec5d9ab9fE7C62EC0326188d6620F110d615a96`

## Edition launch

- Collection: `BlueFun Genesis Signal Canary` (`BFGSC`)
- Contract: `0x54c8351204892a1D0e17F2f006362EdF725aCCaD`
- Standard: ERC-1155 + ERC-2981
- Configured supply: 1,000
- Public phase: free, wallet limit 10, transaction limit 10
- Real mint: token ID 1, quantity 1
- Collection creation: `0x615a281fd5379baa9604fec157f77ab9e3d51926b302f6598b611bc488850e54`
- Phase creation: `0x886de0364dae208132e3b11dbc8145aa32a9c10a651f661f73fcc918cad20d4c`
- Mint: `0x2853c84e2c6024d6d9912f67bcff7d814a12f5e24ed89a1449f42b26e2b4e83e`
- Marketplace listing created and cancelled successfully.

## PFP launch

- Collection: `BlueFun Signal Pioneers Canary` (`BFSPC`)
- Contract: `0x00bF986f325e394842b19c3E6FD420cC32999951`
- Standard: ERC-721 + ERC-2981 + ERC-4906
- Configured supply: 100 unique token metadata records
- Artwork families: Celestial Bird, Tide Technomancer, Orbital Fox
- Public phase: free, wallet limit 5, transaction limit 5
- Real mint: sequential token IDs 1, 2 and 3
- Collection creation: `0x8af5f699efd64f224e217f8b6d3d3254acccdd8c60d6a7a825ab8c0f7c134261`
- Phase creation: `0xde21bedaab0a56aa9a4fa75d421abdda494a004c66b6376b78ce567b3cc15400`
- Mint: `0x360e7414544eb077b842a5852951b3cfc2c97e8196bdc3c1cbbfaa5fe34efa82`
- Marketplace listing created and cancelled successfully.

## Storage and metadata

- All four artwork files and collection/token metadata were uploaded to Pinata/IPFS.
- Edition image, item metadata and contract metadata returned HTTP 200 from the gateway.
- PFP contract metadata, tokens 1, 2, 3 and 100, and all three referenced artwork families returned HTTP 200.
- The PFP batch uploader now supports many metadata records referencing a smaller shared artwork set. This fixes the 3-artwork/100-token launch case.

## Marketplace cleanup

- Both 0.001 ETH canary listings were cancelled.
- ERC-1155 operator approval was revoked: `0xf9c9dd64411cc794770aada226f2d0b012eda932d8f65b02f1aa91ac431fd15d`
- ERC-721 token approval was revoked: `0x5738829139a406ff729c2f6431e32dbb4bba6b9224b47b392208d5f42b5b69d4`
- Final checks: ERC-1155 `isApprovedForAll == false`; ERC-721 `getApproved(1) == address(0)`.

## Verification

- 28/28 Foundry contract tests passed, including fuzzed paid-mint accounting, allowlists, supply invariants, pausing, payout rejection, royalties and both marketplaces.
- Web TypeScript check passed.
- Web ESLint passed with zero warnings.
- Next.js production build passed.
- `/nft` renders both mainnet canary collections.
- Both collection detail routes returned HTTP 200.

## Operational note

The configured Supabase project does not yet contain the NFT index tables. The UI now falls back safely to batched onchain reads with RPC failover, so collections remain visible. Applying the included NFT indexer migrations is still recommended before production traffic for faster queries and historical indexing.
