# BlueFun NFT Launchpad — Internal Security Review

Date: 2026-07-17
Status: internal review completed before the verified Base mainnet deployment; not a substitute for an independent audit

## ERC-721 PFP extension — 2026-07-18

The PFP extension is isolated from the deployed edition factory and reuses the existing bounded `NFTFeePolicy` and pull-payment `BlueDropController`.

- Collection ownership is assigned directly to the factory caller.
- Lifetime supply is immutable; burns never reopen mint capacity.
- Sequential controller minting updates lifetime supply before ERC-721 receiver callbacks.
- Delayed reveal keeps the metadata base URI offchain until reveal while committing an ordered provenance hash.
- Metadata can be permanently frozen at reveal or by a later explicit creator transaction.
- Royalties cannot be increased after the first mint and remain capped at 10%.
- The secondary market is non-custodial, rechecks ownership at purchase and uses pull payments.
- Uploads enforce same-origin/rate limits, signatures, size limits, unique filenames, contiguous IDs and exact metadata/media cardinality.

Automated PFP coverage includes creator ownership, launch-fee routing, sequential unique minting, allowlist binding, approval clearing, interface support, fee splitting, reveal freezing, burn supply invariants and secondary-sale accounting. The complete Foundry suite passes 102 tests. Independent review remains recommended before significant-value public usage.

## Full-stack hardening pass — 2026-07-18

## Signed WETH offers extension — 2026-07-18

The offers extension is isolated in a new non-upgradeable settlement contract and does not modify deployed NFT collections. It uses EIP-712 domain separation bound to chain ID and verifying contract, supports EIP-2098/65-byte EOA signatures and EIP-1271 contract-wallet signatures, rejects high-s malleable signatures, and records fill state before external transfers under a reentrancy guard.

- Makers keep WETH in their own wallets until acceptance.
- Item and collection offers only target factory-registered BlueFun collections.
- ERC-721 item offers are quantity one; collection offers may fill across distinct token IDs.
- ERC-1155 offers support atomic partial fills without exceeding the signed quantity.
- Settlement rechecks seller ownership/balance and approval at execution time.
- Platform fee and ERC-2981 royalty cannot exceed gross consideration; any failed WETH or NFT transfer reverts all fill and payment state.
- Individual cancellation and monotonic nonce floors invalidate signed orders without relying on the database.
- Pausing blocks settlement but never blocks cancellation.
- The API independently verifies typed signatures, EIP-1271 signatures, BlueFun registration, bounds and indexed nonce floors before publishing an order.

Automated offer coverage includes item and collection offers, multi-seller ERC-721 fills, ERC-1155 partial fills, WETH/royalty/platform accounting, EIP-1271, malformed signatures, taker restrictions, expiration, pause, cancellation, nonce floors, wrong registries, approval rollback and 256 fuzz runs. The full Foundry repository suite passes 126 tests with zero failures. This remains an internal security review, not an independent audit.

### BF-WEB-01 — Creator-controlled metadata URL could reach internal services

Severity before fix: High
Status: Resolved

Collection metadata URIs were fetched by the Next.js server and indexer. A collection creator could supply an HTTP URL targeting localhost or a private network service. Metadata reads now accept IPFS URIs and an explicit HTTPS gateway allowlist only. Both readers enforce an 8-second-or-shorter timeout, JSON-compatible content type and a 256 KB streamed response ceiling.

### BF-WEB-02 — Unbounded and malformed PFP upload requests

Severity before fix: Medium
Status: Resolved

The PFP endpoint now rejects oversized request bodies before multipart parsing, caps total media and metadata sizes, checks media signatures, rejects normalized filename collisions, validates contiguous token IDs and reports malformed multipart, JSON and CSV input as client errors. Negative API tests confirm malformed input returns `400` and oversized input returns `413`.

### BF-WEB-03 — Raw numeric wallet input could crash mint/market rendering

Severity before fix: Medium
Status: Resolved

Phase, listing, quantity, allowance and price values were converted with raw `BigInt`/ETH parsing in render and transaction paths. Invalid partial input could throw before the user submitted a form. All such values now use non-throwing parsing and positive/range checks; Merkle proofs are validated as bytes32 arrays before a wallet request is created.

### BF-UI-01 — Launchpad menu opened beyond the left viewport edge

Severity before fix: Medium usability defect
Status: Resolved

The launchpad selector used a centered popover inside a narrow sidebar, producing a negative x-coordinate. It now anchors to the left edge of the brand control. Desktop measurement is `x=147.59`, `right=412.59` at 1440 px. The mobile Create menu is fixed within the viewport at `x=45`, `right=365` on a 390 px viewport and supports outside-click and Escape dismissal.

### BF-DATA-01 — PFP collections did not persist aggregate mint counts

Severity before fix: Medium functionality defect
Status: Resolved in code; live migration pending

PFP mint events incremented a token aggregate row that was never created. The indexer now stores collection standard (`ERC721`/`ERC1155`) and creates the PFP aggregate item at collection creation. The web directory reads indexed collections first and falls back to bounded/cached onchain reads. A fresh-schema defect where the `standard` index existed without its column was also corrected.

The live Supabase project still lacks the NFT tables. The idempotent migration is ready at `apps/indexer/migrations/20260717_nft_launchpad.sql`, but the local account lacks project migration privileges and `DATABASE_URL` is not configured. Until an authorized migration is applied, the UI remains functional through its onchain fallback, but NFT history/listings cannot be persisted by the indexer.

### Dependency review

`npm audit --omit=dev` reports 0 critical, 0 high and 11 moderate advisories in transitive Next.js/PostCSS and wallet-connector/UUID paths. No unsafe major-version override was forced into the wallet stack. These advisories remain a dependency-maintenance item and should be cleared through tested upstream package upgrades.

## Scope

- `NFTFeePolicy`
- `NFTCollectionFactory`
- `BlueEdition1155`
- `BlueDropController`
- `BlueNFTMarketplace`
- NFT deployment script, indexer ingestion and launch/mint/market UI integration

The review covered authorization, fee and royalty bounds, lifetime supply accounting, Merkle allowlists, phase limits, payment accounting, ERC-1155 receiver behavior, reentrancy, malicious external calls, pause behavior, marketplace settlement, deployment authority and indexer spam boundaries.

## Outcome

No unresolved critical or high-severity contract issue was found in this internal pass. The contracts were deployed to Base mainnet after local tests, Slither analysis, mainnet fork simulation and an operational key rotation. An independent Solidity audit remains strongly recommended before broad public promotion or significant-value use.

## Resolved findings

### BF-NFT-01 — Creator transfer validator could execute state-changing code

Severity before fix: Medium
Status: Resolved

The collection originally called a creator-selected transfer validator with a normal external call before balance updates. A malicious or compromised validator could attempt cross-function reentrancy or consume excessive gas.

Resolution:

- validator execution now uses `staticcall`, preventing state changes and state-changing reentrancy;
- validator gas is capped at 100,000;
- validator return data is not copied, preventing return-data bombs;
- failure atomically rejects the transfer;
- an adversarial test proves balances remain unchanged and validator state cannot be modified.

### BF-NFT-02 — Defensive zero-address validation on creator revenue claim

Severity before fix: Low
Status: Resolved

Factory collections cannot configure a zero payout recipient, but the shared controller can technically be called by compatible external collections. The claim path now independently rejects a zero payout recipient before sending native currency.

### BF-NFT-03 — Unregistered collection event spam in the indexer

Severity before fix: Low
Status: Resolved

The mint controller is intentionally compatible with creator-authorized external collections. Without an ingestion boundary, such a collection could emit phase and mint events without paying BlueFun's collection launch fee. The indexer now accepts controller phase and mint events only for collections recorded by `NFTCollectionFactory`.

## Confirmed controls

- Collection launch requires the exact policy fee; default is `0.001 ETH`, with a permanent `0.01 ETH` ceiling.
- Free primary mints pay no percentage fee. Paid primary mints default to `2%`, with a permanent `5%` ceiling.
- Secondary marketplace fee defaults to `0.8%`, with a permanent `1%` ceiling.
- The default deployment uses one platform wallet for admin, pause authority and platform revenue. The revenue address can be rotated without redeploying collections; fee ceilings remain immutable contract-level limits.
- Collection ownership is two-step and belongs to the creator, not BlueFun.
- Lifetime supply cannot be reopened by burning. Supply cannot be increased after the first mint.
- Royalty is capped at 10%, cannot increase after mint, and can be frozen forever.
- Token and collection metadata can be frozen independently.
- Allowlist leaves are bound to chain, collection, token, phase, wallet, allowance, price and currency.
- Wallet limits count the payer, preventing proof forwarding through an alternate recipient.
- Phase state and payment accounting update before mint callbacks; failed callbacks revert the entire transaction.
- Creator, seller, royalty and platform revenue use pull accounting; a reverting recipient cannot block minting or corrupt balances.
- Marketplace listings are non-custodial, require current approval/balance, and only accept factory-registered collections.
- Marketplace purchase, revenue claims, platform flush and collection creation are reentrancy guarded.
- Pausing does not block creator claims, seller claims, platform flushes or listing cancellation.
- All reviewed contract sizes remain below EVM runtime and initcode limits.

## Accepted design properties and residual risks

- A creator can set a transfer validator that rejects all transfers. This is an explicit creator-controlled collection policy, not a BlueFun admin power. Setting the validator to the zero address disables validation.
- Phase and listing schedules use block timestamps. Validators can slightly influence timestamps within normal consensus bounds; schedules should not rely on second-level precision.
- `claimCreatorRevenue` may be called by anyone, but funds can only go to the collection's stored payout recipient. Slither reports the native transfer as an arbitrary-send warning; manual review and tests confirm the caller cannot choose the destination.
- Batch transfer validation performs one bounded external read per token ID. Oversized batches can run out of gas, but the caller supplies the batch and no partial state survives a revert.
- The platform wallet is a central operational trust point. If compromised, an attacker can change fees within hard caps, pause/unpause NFT operations, redirect future platform revenue and redirect future administration by completing the two-step admin transfer. It cannot take creator ownership of collections or directly seize creator/seller pending balances.
- Collection contracts are intentionally non-upgradeable. Policy fees are configurable within hard caps, creators can authorize a replacement mint controller, and a new marketplace can support existing registered collections. A defect in the token implementation itself would require a new collection contract and migration.
- Metadata and media availability depend on the creator's URI/storage choices until metadata is frozen. BlueFun cannot guarantee persistence of third-party HTTP or unpinned IPFS content.
- Smart-contract review does not eliminate platform-key compromise, frontend compromise, RPC/indexer failure, phishing or economic/wash-trading risk.

## Verification evidence

- Foundry NFT suite: 28/28 tests passed, including 256 fuzz runs for paid-mint fee conservation, PFP allowlist/approval/standards checks, one-wallet administration and revenue-wallet rotation coverage.
- Added adversarial coverage for a reverting payout recipient, a state-changing transfer validator and a rejecting ERC-1155 purchase recipient.
- Slither 0.11.4: all five NFT entry contracts reviewed with 79 detectors. Remaining reports are documented design behavior: optional zero validator, timestamp schedules and fixed-destination creator payout.
- Contract size check: largest runtime is `NFTCollectionFactory` at 14,942 bytes, below the 24,576-byte EVM limit.
- Web TypeScript, strict ESLint and production Next.js build pass. The current indexer TypeScript build also passes.

## Mandatory release gates

1. Independent auditor reviews the final commit and publishes findings.
2. All accepted findings receive explicit owner sign-off; all required findings are fixed and retested.
3. Deploy unchanged bytecode to Base testnet and exercise collection launch, free/public/WL paid mint, claims, metadata/royalty freeze, listing, partial fill and cancellation.
4. Confirm the fresh platform/deployer wallet and every deployment address independently before broadcast. Never deploy from the plaintext key previously stored in `.env.deploy`.
5. Verify source code and constructor arguments on the block explorer.
6. Run a low-value canary launch before enabling the public UI.
