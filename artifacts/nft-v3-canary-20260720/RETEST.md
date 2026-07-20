# NFT V3 Retest — 2026-07-20

## Release decision

**Blocked for ERC-721 PFP launches.** ERC-1155 settlement and the shared marketplace/offer flows passed, but the deployed PFP implementation cannot return a revealed `tokenURI` for non-zero token IDs. The collection is not upgradeable, so a corrected PFP factory and a fresh PFP canary are required before production launch.

## Root cause

`BluePFP721._toString` incremented the digit counter without dividing `current` inside the loop. Its second loop had the same missing block structure. A revealed `tokenURI(1)` therefore consumes gas until the RPC aborts. This is why minted PFP cards had no metadata or images, and it also prevents external marketplaces from indexing those token URIs.

The source loop is corrected and covered by regression tests for sequential revealed URIs and placeholder-to-revealed transitions. The web app also avoids one `tokenURI` RPC call per grid card and derives each URI from the collection's `revealed`, `baseURI`, and `placeholderURI` state. This restores the existing BlueFun canary UI, but it cannot repair third-party indexing of the already deployed contract.

## Verification completed

- Full Foundry suite: **149 passed, 0 failed, 0 skipped** across 22 suites.
- Invariant campaigns: four invariants, 128,000 calls each, zero reverts.
- PFP regression suite: 16 passed, including the two new `tokenURI` regressions.
- Web typecheck, zero-warning lint, production build, and indexer TypeScript build: passed.
- Current PFP metadata endpoint: valid name, image, and three attributes.
- Token image proxy: HTTP 200, cached immutable WebP, 384×384.
- Collection UI: four PFP images rendered; item details, traits, search, grid/list switching, offers, analytics, share card, edition/PFP launch forms, and disconnected dashboard verified.
- API validation: collection, items, activity, listing, offers, share card, metadata, image, and invalid-input paths checked.
- Indexer: removed quota-exhausted/429 public RPC defaults; restarted healthy with three responsive Base endpoints.

## Performance retest

Thirty simultaneous requests per endpoint on the local production server:

| Endpoint | Before p95 | Cached p95 |
| --- | ---: | ---: |
| Activity | 4,772 ms | 38 ms |
| Items | 1,831 ms | 24 ms |

Cold misses are coalesced into one upstream query. The response cache is TTL-bound and capped at 250 entries to prevent unbounded memory growth.

## Required release steps

1. Deploy a factory containing the corrected `BluePFP721` bytecode.
2. Have the Safe configure the NFT controller to the corrected PFP factory.
3. Launch a fresh PFP canary and verify `tokenURI`, external metadata indexing, mint, list, buy, offer, cancel, reveal, freeze, payouts, fees, pause controls, and indexer/UI refresh.
4. Only then enable public PFP launches and publish the application.
