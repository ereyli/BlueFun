# BlueFun vNext Contract Security Review

Date: 2026-07-15
Scope: vNext contracts, deployment scripts, Foundry tests, Base fork execution and deployment configuration.

## Release assessment

No known high or critical finding remains in the reviewed vNext scope. This is a repository-grounded engineering review, not an independent third-party audit, and it cannot guarantee the absence of undiscovered defects.

Base vNext was deployed at block `48678791`; all twelve deployment contracts are source-verified on BaseScan. Robinhood vNext was deployed at block `10703400`; all eleven deployment contracts are source-verified on Robinhood Blockscout. Robinhood creation remains gated until its low-value Bond and Direct live smoke succeeds.

## Security properties

- Bond, Direct and graduated Bond trading use bounded `FeePolicy` values.
- `UnifiedFeeHook` accepts only exact-input swaps and overrides the LP fee to zero.
- Pool registration is restricted to a permanently frozen Bond/Direct locker allowlist.
- Pool token and creator attribution is one-time and cannot be overwritten.
- Creator revenue is pull-based, preventing a creator receiver from blocking buy swaps.
- Sell burn transfers only the configured token fee to `0x0000…dEaD`.
- Platform revenue uses non-blocking routers and pull-based treasury withdrawal.
- Base trade platform revenue splits automatically between staking and treasury.
- Remote staking revenue deposited on Base is not split a second time.
- The Robinhood bridge reserve can be released only to its timelock-configured recipient.
- LP principal and the position NFT have no admin, creator or guardian withdrawal path.
- Mutable policy and future-launch configuration is behind a seven-day timelock with rotatable owner and guardian roles.
- Guardian action can pause new launches but cannot seize reserves, LP or staking principal.

## BLUE staking V2

- Stake principal, cooling principal and accounted native rewards are separately tracked.
- Reward accounting remains solvent under stateful randomized stake, repeated unstake, partial cancel, partial withdraw, fund, claim and time-advance sequences.
- Additional unstake requests aggregate and reset the full pending balance's 30-day timer.
- Partial cancellation and partial withdrawal avoid unnecessary token lockup.
- Rewards arriving with no active stake are queued.
- Forced native ETH can be recognized only through the configured distributor.
- Admin recovery excludes staking principal and accounted reward liabilities.
- Emergency exit is irreversible and lets users recover principal without transferring custody to administration.

## Verification evidence

- `forge test`: 74 tests passed.
- vNext staking invariants: 256 runs and 128,000 calls per invariant, zero reverts.
- Existing curve fuzz tests: 256 randomized runs.
- Real Base Uniswap v4 fork: atomic Direct initial buy, creator pull revenue, platform split, sell and exact 0.3% token burn passed.
- `forge build --sizes`: all production contracts remain below EVM runtime and initcode limits.
- Slither review completed. Reported vNext items were either hardened or assessed as expected patterns:
  - timelock arbitrary calls are the intended delayed governance mechanism;
  - the `FullMath` XOR seed is the standard modular-inverse implementation, not exponentiation;
  - the router clears pending staker revenue before calling its immutable vault and every external entry point is non-reentrant;
  - timestamp use is limited to deadlines, streams and cooldowns;
  - token transfers are protected by non-reentrancy and balance-delta checks;
  - router external calls target immutable trusted vaults or use checks-effects-interactions.
- Base and Robinhood mainnet deployment simulations completed.

## Operational release gates

The following remain required before public activation on each network:

1. Fund the deployer with sufficient gas and complete broadcast.
2. Source-verify every deployment contract and constructor argument.
3. Run low-value Bond and Direct mainnet smoke launches, buy, sell, burn, revenue split and graduation checks.
4. Deploy web and indexer together so no generation is only partially activated.
5. Move timelock owner and guardian roles to independent hardware-backed multisig addresses.
6. Enable legacy staking emergency exit only after the V2 UI and withdrawal path are live.

Base source verification is complete, but the live low-value smoke launch is pending additional Base deployer funding for the `0.001 ETH` launch fee. The legacy staking vault has therefore not been placed into emergency mode.

## Residual risks

- Custom Uniswap v4 hook pools may take time to appear in external aggregators.
- Token-only Direct pools require buy-side ETH depth before reliable sells.
- Exact-output swaps are intentionally unsupported.
- RPC/indexer outages can affect the interface without changing onchain custody.
- Low liquidity, volatility, price impact and irreversible user transactions remain market risks.
- A third-party audit and public bug bounty are recommended before describing the system as fully audited.
