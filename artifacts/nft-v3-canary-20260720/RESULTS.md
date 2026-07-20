# NFT V3 Base Mainnet Canary — 2026-07-20

## Result

The canonical NFT V3 deployment completed an end-to-end Base mainnet canary with two isolated test wallets. All 25 transactions in the primary broadcast were confirmed with receipt status `0x1`; the separately scheduled PFP reveal was also confirmed.

## Collections

| Type | Collection | Supply | Minted | State |
| --- | --- | ---: | ---: | --- |
| ERC-1155 edition | `0xca9f476Edbc85709656112f14906db281Be5e3c7` | 1,000 | 3 | Public mint live |
| ERC-721 PFP | `0xa958d9E63310574c81e9ee181C40e1669cBc9BD1` | 1,000 | 3 | Revealed; token metadata frozen |

Both collections are owned by the deployer canary creator, use that address as their creator payout recipient, retain a 10-token creator reserve, and are registered by the current V3 factories.

## Validated flows

- Paid public mint for both standards
- Primary mint fee paid automatically to the Safe
- ERC-1155 fixed-price listing, purchase, cancellation, and partial-capable settlement
- ERC-721 fixed-price listing, purchase, and cancellation
- ERC-1155 WETH item offer acceptance
- ERC-721 WETH item offer acceptance
- Individual offer cancellation and global nonce-floor cancellation
- Permissionless scheduled reveal after the deadline and permanent PFP metadata freeze
- Automatic native/WETH payout settlement with no marketplace or offers escrow balance
- Indexer discovery, collection pages, item inventory, activity, analytics, and share dialog

## Settlement evidence

Configured fees during the canary:

- Primary mint fee: 2% (`200 bps`)
- Marketplace/offer fee: 0.8% (`80 bps`)
- Creator royalty: 5% (`500 bps`)

Each fixed-price sale used a gross amount of `2,000,000,000,000 wei` and emitted:

- Platform fee: `16,000,000,000 wei`
- Creator royalty: `100,000,000,000 wei`
- Seller proceeds: `1,884,000,000,000 wei`

Each accepted offer used a gross amount of `3,000,000,000,000 wei` and emitted:

- Platform fee: `24,000,000,000 wei`
- Creator royalty: `150,000,000,000 wei`
- Seller proceeds: `2,826,000,000,000 wei`

The V3 policy reports the Safe `0x144A3f70C0bf33124852E3891011e033b909F46d` as admin, guardian, and platform wallet. New collections, new mints, and marketplace settlement are unpaused.

## Primary transaction references

- Edition launch: `0xdbed3d239884f9426fa1280f2eb0df91631ce5ec47fbb9dcd5b22894d4c74e6b`
- PFP launch: `0x564e92a1782122fce9f9c023ff1012619f474805088a690be254be20b7980d71`
- Edition mint: `0x01ca9a629c35d6da5a6ddf92392fe640ce9fe55b3f19fc75ea3c8e5139772667`
- PFP mint: `0x1ade1100c7982aefb213f0e431447aedb65e633e6a323c491123af10c197c12a`
- Edition purchase: `0xa74c753028e050d53d97f35b33a9c4d4af1a5421e81be6c234dd935f5afde1f4`
- PFP purchase: `0x7d2fe83bad3b8c26b68651871a1fe2db07ada616f171f4a099ce52c3564db3e3`
- Edition offer acceptance: `0xf142b3f96ae9fc181b93655722f8906e1c4899e0670b8b5aaff832cd5e8134f1`
- PFP offer acceptance: `0xfb1d900257856d2575508b221d653d0bf77aff4067e3c52a2534f1b677b1059d`
- PFP reveal: `0xd7ed3da351a832f4f9828a41aefceadb7c01c832e4d11b17a7ecb63b3070b966`

## Verification

- Solidity suites: 62 passed, 0 failed
- Web production build: passed
- Web typecheck: passed
- Web lint: passed with zero warnings
- Indexer health: `ok`, no last error
- Both local production collection pages: HTTP 200
- Corrected activity summaries: one sale and `2,000,000,000,000 wei` volume per collection

## Operational cleanup

The creator's temporary edition-offer approval was revoked in transaction `0x43e2ba2f0d9590520c2b5d480b8ea8a6f40daff3214bc44d5dce38905c85f91e`. The isolated buyer canary wallet still has temporary marketplace approvals and a small WETH allowance/balance; `CleanupNFTLaunchpadV3Canary.s.sol` is provided to revoke and unwrap them when its local keystore is unlocked. These permissions affect only the isolated canary wallet and do not grant access to the Safe or protocol administration.

## Residual release conditions

This canary provides strong functional and integration evidence, but is not a substitute for an independent external smart-contract audit. The prepared Safe transaction that pauses the superseded fee policy is operational hardening and can be executed later when the signer quorum is available; the application and current V3 contracts do not depend on it.
