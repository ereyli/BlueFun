# BlueFun NFT final deployment review

Status: **deployment blocked until the V3 candidate's independent review, address/indexer cutover and operational
checklist are complete.**

This review compares the BlueFun NFT contracts with the settlement and order patterns used by Seaport/OpenSea,
LooksRare-style WETH fallback settlement, ERC-2981 royalties and ERC-4906 metadata refreshes.

## V2 findings and V3 corrections

| Severity | V2 finding | V3 candidate |
| --- | --- | --- |
| Critical UX / funds | Fixed-price seller proceeds, royalties, primary mint revenue and platform fees accumulated in contracts and required later claims. | Every mint and fixed-price sale now distributes funds atomically. Seller, creator and platform receive ETH in the purchase transaction. |
| High availability | A seller, royalty recipient or payout smart contract that rejects ETH could not be paid automatically. | Native payment uses a bounded-gas transfer and automatically wraps only that recipient's amount to Base WETH when ETH is rejected. The transaction leaves no normal sale proceeds in the market/controller. |
| High fairness | Scheduled PFP reveal stored the final metadata base URI before reveal, allowing pre-reveal metadata inspection. | Scheduled reveal stores a salted commitment domain-separated by collection and chain. The URI and secret are supplied only after the deadline; the schedule cannot be bypassed or changed after minting starts. |
| High economic integrity | Admin fee changes could silently reduce the creator/seller net amount after a mint phase or listing was created. | Mint phases and listings snapshot maximum fee terms. Higher deductions make the action revert instead of silently changing net proceeds. Offer acceptance has a minimum-seller-proceeds path. |
| High trust | A creator could add a new mint controller or arbitrary transfer validator after collectors had minted. | Controller permissions and validator authorization are fully immutable after the first mint. |
| High governance | Fee increases and payout-wallet replacement were immediate admin actions. | Fee increases have a 48-hour onchain delay; reductions remain immediate. Platform-wallet replacement is two-step. |
| Medium observability | Pull-payment balances required four marketplace reads and claim UX. | `AutomaticPayout` events identify recipient, amount and whether WETH fallback was used. |

The WETH offer contract already settled seller proceeds, platform fees and ERC-2981 royalties directly from the
maker. V3 adds an explicit minimum-proceeds acceptance path so the seller can bind the displayed net quote.

## Required before one final mainnet deployment

1. Run the complete Foundry suite, V3 Base fork tests, fuzz/invariant tests and an independent Solidity audit.
2. Deploy with a Safe multisig as `NFT_ADMIN`, a separate guardian, the intended payout wallet and canonical Base WETH.
3. Verify every source and constructor argument on Base explorers.
4. Set the reviewed V3 addresses and protocol-version flag atomically. V3 ABI paths are already feature-gated;
   preserve read/claim support for V1/V2 contracts.
5. Re-check the feature-gated scheduled-reveal flow: securely back up the URI and random 32-byte secret, submit the
   salted commitment at creation, and provide both values only at execution.
6. Re-check the feature-gated `acceptOfferWithMinProceeds` flow and display gross, platform fee, royalty and seller
   net before signing.
7. Update the indexer for `AutomaticPayout`, V3 factories, new marketplaces and committed reveal events.
8. Give V1/V2 users a permanent legacy claim page. Existing pending balances cannot be reassigned by V3.
9. Use a dedicated production RPC, redundant event ingestion, reorg handling and monitoring before public traffic.
10. Run a small-value mainnet smoke sequence: collection creation, paid/free mint, listing, purchase, WETH offer,
    royalty payout, rejecting-ETH smart-wallet fallback, cancellation, reveal commitment and emergency pause.

No V3 deployment should be broadcast until every item above is signed off.

## Competitive feature gaps that are not deployment-security blockers

- Gasless signed listings: current listings are onchain; Seaport-style orders require only approval plus a signature.
- Trait offers and token-set offers: BlueFun currently supports item and whole-collection offers.
- Batch sweeps/cart purchases.
- Dutch/English auctions.
- Additional settlement currencies such as USDC.
- Shared Seaport order interoperability and external liquidity.

These improve liquidity and UX but should be added after the settlement core is independently audited. Rebuilding a
general Seaport-equivalent exchange inside the final deployment would increase audit surface and deployment risk.

## Primary references

- Seaport interface and direct consideration recipients: https://docs.opensea.io/docs/seaport-interface
- Seaport order/consideration model: https://docs.opensea.io/docs/seaport-models
- OpenSea marketplace overview and offer matching: https://docs.opensea.io/docs/seaport
- ERC-2981 royalty standard: https://eips.ethereum.org/EIPS/eip-2981
- ERC-4906 metadata update extension: https://eips.ethereum.org/EIPS/eip-4906
- LooksRare low-level ETH/WETH fallback library catalogue: https://github.com/LooksRare/contracts-libs
- Payment Processor V2 marketplace workflows and seller net disclosure:
  https://github.com/limitbreakinc/payment-processor-v2
