# NFT V4 Base Mainnet — 2026-07-20

## Canonical deployment

| Component | Address |
| --- | --- |
| Fee policy | `0xc982023f393626309e13b7b75d988c273a9f7786` |
| Drop controller | `0xf7fc2f208b936a5858f9ae7f7750147c8284a2c6` |
| ERC-1155 factory | `0xd8cf5150a4d789cab4b03855d3ff536c78fd4b33` |
| ERC-721 factory | `0x022742905a07f4534f9794ceb8c42be23a1c6815` |
| ERC-1155 marketplace | `0x5be0b302e32031378fdbdea3e5bb3d487e345761` |
| ERC-721 marketplace | `0x8a777d7d590b658ab07b0aee90ccc51b79c2981d` |
| WETH offers | `0xdfb2ae739446fc8ffc57793005e687ce695dda64` |

All eight deployment/configuration transactions confirmed with status `1`. All seven deployed contracts are source-verified on BaseScan. The Safe `0x144A3f70C0bf33124852E3891011e033b909F46d` is the policy admin, guardian and platform wallet. The controller configurator is permanently cleared.

## V4 PFP canary

- Collection: `0xebec4d3b7a638a7149ca1694f96f107cb43b7747`
- Supply: 1,000
- Minted: 3
- Owner: deployer canary wallet
- Collection and child source: verified on BaseScan
- `tokenURI(1)`: `ipfs://QmWFiDvTPFY6sR99JZffzaMcrYwW88pw1HTswEjZNp8bpd/bluefun/1`
- `tokenURI(3)`: `ipfs://QmWFiDvTPFY6sR99JZffzaMcrYwW88pw1HTswEjZNp8bpd/bluefun/3`
- Fixed-price listing was created and cancelled; marketplace approval was revoked.
- The `0.001 ETH` launch fee arrived automatically in the Safe, increasing its observed balance from `0.002000172 ETH` to `0.003000172 ETH`.

All seven canary transactions confirmed with status `1`. The indexer discovered the V4 collection, three mints and cancelled listing; local collection and API routes return HTTP 200.

## Regression verification

- Foundry: 150 passed, 0 failed, 0 skipped.
- Web typecheck and zero-warning lint: passed.
- Web and indexer production builds: passed.
- Indexer health after the V4 cutover: `ok`, no last error.
- The former V3 PFP collection API returns 404 as non-current; it is absent from Explore.

The old contracts remain immutable Base chain history and cannot be deleted. They are not referenced by the application or indexer. `safe-retire-nft-v3.json` contains the three Safe calls needed to pause the superseded V3 policy onchain.
