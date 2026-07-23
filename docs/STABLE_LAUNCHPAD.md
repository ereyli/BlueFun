# BlueFun Stable Direct Launchpad

Status: deployed and canary-tested on Stable mainnet

Last reviewed: 23 July 2026

## Network and external contracts

| Item | Value |
| --- | --- |
| Network | Stable mainnet |
| Chain ID | `988` |
| Gas and settlement asset | USDT0 |
| RPC | `https://rpc.stable.xyz` |
| WebSocket | `wss://rpc.stable.xyz` |
| Explorer | `https://stablescan.xyz` |
| USDT0 ERC-20 | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` |
| Uniswap v3 Factory | `0x88F0a512eF09175D456bc9547f914f48C013E4aA` |
| Uniswap v3 Position Manager | `0x3BdC3437405f7D801b6036532713fc1F179136a6` |
| Uniswap SwapRouter02 | `0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a` |
| Uniswap QuoterV2 | `0xb070179E7032CdA868b53e6C1742F80c9e940d1A` |

## BlueFun mainnet contracts

| Contract | Address |
| --- | --- |
| Governance timelock | `0x55b000e7645313de1715dc58a8952d93993b10d2` |
| Fee policy | `0x7a6287fae63992eadfd7adf414e441561fb221a7` |
| Revenue router | `0xf218baf4061b3c2ca6256305b449a130778e0c04` |
| Direct liquidity locker | `0x8d51017c392552333a679ccb60b5df84314c64cd` |
| Direct launch factory | `0xc2c29581179111aa94ba12affd3486879e42090c` |
| Direct deployment block | `32827109` |

All five active BlueFun contracts have an `exact_match` source verification
on Sourcify for chain `988`.

Stable exposes the same USDT0 asset as an 18-decimal native balance and through a
6-decimal ERC-20 interface. BlueFun stores launch fees in native 18-decimal
units. Uniswap v3 trades and LP fee accounting use the 6-decimal ERC-20
interface. The web and indexer normalize the latter to the common 18-decimal
display/database format.

## Product behavior

Stable supports Direct DEX launches only. Bond is deliberately unavailable.

- Supply is fixed at 1,000,000,000 ERC-20 tokens.
- The creator receives no free allocation.
- The complete supply is minted into a one-sided Uniswap v3 position.
- The position NFT is held permanently by `StableV3LiquidityLocker`.
- No contract path can decrease liquidity, burn the position NFT, approve it,
  or transfer it.
- The first executable price is approximately 4,009 USDT0 FDV.
- The creator may make an optional first buy, capped at 5% of supply. The web
  first obtains an exact USDT0 ERC-20 allowance; token creation, LP minting and
  the buy are atomic in the following launch transaction.
- Launch fee begins at 0.001 USDT0.
- The v3 pool fee tier is 1%.

Fee distribution preserves the established BlueFun percentages:

| Swap direction | Platform Safe | Creator | Burn |
| --- | ---: | ---: | ---: |
| Buy, paid in USDT0 | 0.7% USDT0 | 0.3% USDT0 | — |
| Sell, paid in launch token | 0.7% launch token | — | 0.3% launch token |

Creator revenue therefore accumulates only from buys and is claimable as
USDT0. Platform USDT0 and launch-token revenue is swept only to the fixed
BlueFun Safe address. Sell-token burn amounts are transferred to
`0x000000000000000000000000000000000000dEaD`.

Uniswap v3 fees accrue to the position and are accounted when anyone calls
`collectFees(positionId)`. Collection does not unlock or reduce principal.

## Governance and Safe activation

Deployment creates a seven-day `StakingTimelock` temporarily owned by the
Stable deployer. Fee policy and revenue administration belong to that
timelock. The Direct factory is also owned by the timelock.

The treasury and permanent LP platform-fee recipient are set from day one to
the deterministic BlueFun Safe address:

`0x144A3f70C0bf33124852E3891011e033b909F46d`

The Safe does not need to have code at deployment time. Funds sent to its
counterfactual address remain at that address and become controllable when the
same Safe is deployed on Stable.

The Safe is deployed with the expected three owners, a 2-of-3 threshold and no
enabled modules. The timelock ownership proposal was scheduled in transaction
`0x5c9b6d40eedcd1500b3c2f254018dfc8c81c004f22270155c5802ad330f28ff6`.
Operation
`0x85abed474455ca59f0c073846a016ff63bdfbb32024141727c02eb754fb77dc2`
is executable from `2026-07-30 18:01:26 UTC`.

After the delay:

1. Anyone executes the exact scheduled operation.
2. Confirm `pendingOwner() == SAFE`.
3. Import `docs/safe-transactions/stable-timelock-safe-accept.json`.
4. Collect two Safe signatures and execute `governance.acceptOwner()`.
5. Confirm `owner() == SAFE` and `pendingOwner() == address(0)`.
6. Retire the deployer after sweeping only unused operational gas.

The guardian is separate from both deployer and Safe. It can pause new
launches and cancel queued governance actions; it cannot withdraw LP
principal or redirect platform fee revenue.

## Verification gates

- Unit and mock integration tests cover fixed supply, token-only LP custody,
  fee splits, sell burn, creator claims, launch-fee routing, first-buy limits,
  USDT0 precision, one-time factory setup and immutable fee ratios.
- A Stable mainnet fork test uses the canonical v3 Factory, Position Manager
  and SwapRouter02 to create a pool, buy, sell, collect fees and verify that
  the position NFT remains in the locker.
- The low-value mainnet canary launched BFSC, bought and sold through the
  canonical v3 router, collected both fee sides, paid creator and Safe revenue,
  burned the sell share, and verified that Uniswap position NFT `347` remains
  owned by the permanent locker.

The deployment catalog under `contracts/deployments/stable-direct-mainnet.json`
is the source of truth for addresses and receipts.
