# BlueFun NFT V3 security audit

Date: 2026-07-20  
Reviewed commit: `45007f146454a175f2123fcdecc0c7c6c89e9973`  
Status: **NOT READY FOR MAINNET**

This is an internal, repository-grounded security review. It is not a substitute for an independent audit by a
specialist Solidity firm.

## Scope

- `BlueDropController`
- `BlueEdition1155`
- `BluePFP721`
- `NFTCollectionFactory`
- `NFTPFPFactory`
- `BlueNFTMarketplace`
- `BlueNFTMarketplace721`
- `BlueNFTOffers`
- `NFTFeePolicy`
- `NativeSettlement`
- NFT deployment scripts, interfaces and Foundry tests

## Method

- Manual review of access control, state transitions, supply accounting, settlement ordering, callbacks,
  signatures, replay protection, fee/royalty changes, reveal integrity and deployment configuration.
- Slither 0.11.4 with 100 detectors, run separately against every in-scope contract.
- Clean-cache Foundry build and complete test run.
- Targeted review against ERC-721, ERC-1155, ERC-1271, EIP-712, ERC-2981 and ERC-4906 behavior.

Validation result: **139 tests passed, 0 failed**. The NFT-specific suites account for 53 passing tests, including
256-run fuzz cases. Foundry coverage could not produce a reliable report: the non-IR run hit `stack too deep`, and
the `--ir-minimum` workaround hit a Yul stack exception.

## Finding summary

| ID | Severity | Finding | Mainnet blocker |
| --- | --- | --- | --- |
| H-01 | High | Scheduled reveal is not enforceable and its commitment is unsalted | Yes |
| M-01 | Medium | A platform-wallet rotation can halt all new collection creation | Yes |
| M-02 | Medium | Legacy deployment scripts can deploy current bytecode without V3 safety gates | Yes |
| M-03 | Medium | Mint-controller revocation after first mint is irreversible | Yes |
| L-01 | Low | The controller accepts unregistered look-alike collections | Recommended |
| L-02 | Low | The unprotected legacy offer-acceptance entry point remains available | Recommended |
| L-03 | Low | `isOfferValid` does not test WETH balance or allowance | No |
| L-04 | Low | Dead V2 pull-payment state and claim entry points remain in V3 bytecode | Recommended |
| I-01 | Informational | Metadata immutability remains creator-optional | Product disclosure |
| I-02 | Informational | PFP mint/airdrop loops have no protocol quantity ceiling | No |

## Detailed findings

### H-01 — Scheduled reveal is not enforceable and its commitment is unsalted

`BluePFP721.reveal()` can be called by the owner at any time before the scheduled deadline and does not check
`scheduledRevealTime` or `scheduledRevealCommitment`. The owner can also cancel or replace a scheduled commitment
after minting has started. Therefore the advertised deadline and committed URI do not constrain the creator.

The commitment is `keccak256(bytes(uri))`. A URI has low entropy compared with a random secret and may be guessed
from public IPFS/pinning data. The stored `provenanceHash` is informational and is not verified against the revealed
URI or metadata ordering.

Impact:

- Early reveal is possible.
- A creator can cancel or replace the committed result after sales begin.
- Predictable URIs can be brute-forced before the deadline.
- The contract cannot honestly guarantee a fair or immutable delayed reveal.

Required remediation:

1. When a schedule exists, reject the unrestricted `reveal()` path.
2. After the first mint, permanently lock cancellation and commitment replacement.
3. Commit to `keccak256(abi.encode(uri, secretSalt, address(this), block.chainid))`.
4. Reveal with both URI and salt.
5. Define whether the provenance hash commits to the ordered metadata set and verify/document that workflow.
6. Add adversarial tests for early reveal, cancellation after mint, rescheduling after mint, wrong salt and front-run
   attempts.

Relevant code: `BluePFP721.sol:317-347`.

### M-01 — A platform-wallet rotation can halt all new collection creation

The marketplaces and mint controller use ETH-to-WETH fallback settlement. The two factories do not: they forward the
launch fee with a raw ETH call and revert if the platform wallet rejects native ETH. `NFTFeePolicy` permits rotation
to any address that can call `acceptPlatformWallet`, without proving that it accepts ETH.

Impact: rotating to a non-payable Safe module or another rejecting contract globally blocks ERC-1155 and ERC-721
collection creation until another wallet is proposed and accepts.

Required remediation: give both factories the same canonical WETH fallback used by `NativeSettlement`, or constrain
and test the payout wallet during rotation. Add a rejecting-wallet regression test.

Relevant code: `NFTCollectionFactory.sol:84-88`, `NFTPFPFactory.sol:88-92`,
`NFTFeePolicy.sol:139-150`.

### M-02 — Legacy deployment scripts can deploy current bytecode without V3 safety gates

The historical Base scripts import the current contract sources. They can therefore deploy V3-era bytecode while
reusing an old policy, accepting arbitrary WETH/network values, or assigning admin, guardian and treasury to the same
EOA. Only `DeployNFTLaunchpadV3BaseMainnet` enforces chain ID 8453, canonical Base WETH, multisig admin and separated
roles.

Impact: running the wrong valid script can create an apparently current deployment with the exact governance and
configuration weaknesses the V3 gate was designed to prevent.

Required remediation: make every historical script revert with a deprecation error, move it outside the executable
script tree, or pin it to archived source copies. Keep a single reviewed mainnet entry point and test its guards.

Relevant code: `DeployNFTLaunchpadBaseMainnet.s.sol:28-42`,
`DeployNFTLaunchpadV2BaseMainnet.s.sol:36-60`, `DeployNFTPFPBaseMainnet.s.sol:20-36`,
`DeployNFTOffersBaseMainnet.s.sol:28-48`.

### M-03 — Mint-controller revocation after first mint is irreversible

After the first mint, a collection owner may revoke the active controller but cannot authorize it again or authorize
a replacement. An accidental revocation or a controller incident permanently disables public/allowlist minting for
the collection's remaining non-reserved supply.

This also conflicts with the collection's stated “modular mint controllers” and controller replacement comments.

Required remediation: choose and document one model:

- immutable controller with no misleading post-deploy setter; or
- a delayed, two-step controller migration that cannot grant arbitrary creator mint authority and is visible to
  collectors before activation.

Relevant code: `BlueEdition1155.sol:143-148`, `BluePFP721.sol:178-183`.

### L-01 — The controller accepts unregistered look-alike collections

`BlueDropController` validates only an arbitrary target's `owner()`, `maxSupply()` and `mintByController()` behavior.
It has no factory registry check. Anyone can deploy a look-alike contract and cause the canonical controller to emit
convincing `PhaseCreated` and `NFTMinted` events.

No protocol funds can be stolen through this path, but an event-only indexer can display fake launches and activity.

Required remediation: require registration in either the ERC-1155 or PFP factory, or require every indexer/API query
to verify the originating collection against the canonical factory registries.

Relevant code: `BlueDropController.sol:120-133`, `BlueDropController.sol:314-326`,
`BlueDropController.sol:358-360`.

### L-02 — The unprotected legacy offer-acceptance entry point remains available

`acceptOfferWithMinProceeds` protects the seller's displayed net amount, but the public `acceptOffer` entry point
still passes a minimum of zero. A stale or malicious UI can route the seller through the weaker function.

The seller must still submit the transaction, and fee/royalty ceilings limit the loss, so this is not an involuntary
fund theft. It is nevertheless avoidable API risk in a new deployment.

Required remediation: remove the legacy entry point from V3 or make it apply a signed/snapshotted deduction ceiling.
Keep the old ABI only for already deployed V2 addresses.

Relevant code: `BlueNFTOffers.sol:137-152`.

### L-03 — `isOfferValid` does not test WETH balance or allowance

The function validates structure, time, cancellation and signature, but not whether the maker currently has enough
WETH or allowance. It can report an offer as valid even though acceptance always reverts.

Impact: stale/spam offers and failed seller transactions. No direct fund loss.

Required remediation: return funding/allowance validity separately so indexers can distinguish a valid signature from
an executable offer.

Relevant code: `BlueNFTOffers.sol:201-213`.

### L-04 — Dead V2 pull-payment state and claim entry points remain in V3 bytecode

The V3 marketplace and controller never accrue the old pending-balance mappings, but still expose the mappings and
claim/flush methods. This increases bytecode and audit surface, confuses integrators, and does not help legacy users:
legacy balances live at the old contract addresses.

Forced ETH also cannot be assigned to these zero mappings and remains unrecoverable.

Required remediation: remove dead pull-payment state/functions from V3. Preserve legacy support in a separate ABI and
UI route pointed at V1/V2 addresses.

Relevant code: `BlueDropController.sol:88-89,232-250`, `BlueNFTMarketplace.sol:44-50,160-176`,
`BlueNFTMarketplace721.sol:41-46,115-131`.

### I-01 — Metadata immutability remains creator-optional

ERC-1155 item URIs and revealed PFP base URIs remain mutable until the creator explicitly freezes them. This is
allowed by NFT standards, but collectors must not be shown an “immutable” or “verified metadata” badge unless the
corresponding onchain freeze state is true.

### I-02 — PFP mint/airdrop loops have no protocol quantity ceiling

PFP minting performs an ERC-721 receiver callback for every token. A creator can configure a very large
`maxPerTransaction`; oversized attempts will run out of gas. This does not block smaller mints, but the UI and
controller should impose a practical per-transaction ceiling.

## Slither triage

Slither reported controlled ETH transfers, timestamp comparisons, ignored royalty receiver values and PFP receiver
callbacks. Manual triage found:

- Automatic payouts are inside `nonReentrant` entry points, update state before interaction and atomically revert on
  failure.
- WETH validation is performed indirectly by `NativeSettlement.validate`; the missing-zero warnings are false
  positives.
- Timestamp use is intentional for phases, listings and governance delays.
- PFP mint supply is reserved in `totalLifetimeMinted` before receiver callbacks. The reported cross-function
  reentrancy does not bypass the lifetime cap, although callback-loop complexity warrants regression tests.
- Solidity local variables default to zero; the uninitialized-local warnings are false positives.

## Positive properties verified

- Fixed-price sales and paid mints atomically split seller/creator, royalty and platform proceeds.
- Rejecting native recipients receive canonical WETH without leaving normal proceeds in the marketplace/controller.
- Offer signatures bind chain ID and verifying contract and reject high-`s` ECDSA signatures.
- Offer fill state is updated before external WETH/NFT calls and acceptance is non-reentrant.
- Listing and mint-phase fee snapshots prevent later fee increases from silently worsening existing terms.
- Royalty rate cannot increase after mint and is capped at 10%.
- Supply is based on lifetime minting; burning never reopens supply.
- Admin and ownership transfers are two-step.
- Pause operations do not prevent listing/offer cancellation.
- V3 deployment entry point checks Base chain ID, canonical WETH, multisig admin and role separation.

## Release decision

Do not deploy the reviewed commit. H-01 and M-01 through M-03 must be corrected and covered by regression tests.
After corrections, repeat Slither, the full Foundry suite, Base-fork smoke tests and an independent external audit.

Primary standards:

- https://eips.ethereum.org/EIPS/eip-721
- https://eips.ethereum.org/EIPS/eip-1155
- https://eips.ethereum.org/EIPS/eip-712
- https://eips.ethereum.org/EIPS/eip-1271
- https://eips.ethereum.org/EIPS/eip-2981
- https://eips.ethereum.org/EIPS/eip-4906
