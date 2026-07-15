# BlueFun Contract Security Review

Date: 2026-07-15
Scope: `contracts/src`, deployment scripts, Foundry tests, and the currently configured Base and Robinhood deployments.

## Executive summary

The initial review found a critical Direct liquidity-range defect, permissionless pool-initialization griefing, copied-calldata creator theft, an owner reserve-drain path, and immediate EOA administration. The secure replacements described below remediate those findings and are now deployed on Base and Robinhood. Historical Bond deployments remain indexed for existing tokens, but their factory controls were moved behind the new 48-hour timelocks and their market ownership was transferred to a guardian contract that cannot schedule or execute reserve withdrawals.

No principal-withdrawal or position-NFT transfer function exists in either new production liquidity locker. Real Base and Robinhood fork tests confirmed that new Bond and Direct positions can be created, swapped, and fee-collected without decreasing recorded LP principal. The Direct fork invariant additionally bounds the post-mint token residual to rounding dust.

This review is a repository-grounded engineering assessment, not an independent third-party audit.

## Remediation and deployment status

- **C-01 remediated:** range square-root prices are derived from canonical tick math, and Direct launch reverts unless the 1 billion-token deposit leaves only bounded rounding dust.
- **H-01 remediated:** both lockers use a `beforeInitialize` hook whose address carries the required Uniswap v4 flag. Only the permanently frozen locker allowlist can authorize the exact pool ID and initial price, and initialization is verified from `StateView` after the PositionManager call.
- **H-02 remediated:** CREATE2 salts are bound to creator and chain; prediction APIs include creator; Direct create calls commit to the config hash and a deadline.
- **H-03 remediated for new markets and neutralized for historical markets:** the new market bytecode has no emergency-drain entry point. Existing market ownership is held by `BondMarketEmergencyGuardian`, which can only cancel a legacy schedule and cannot schedule or execute one.
- **M-01 remediated:** Direct config changes require the 48-hour two-key timelock, while the launch transaction supplies the expected config hash and deadline.
- **M-02/M-03 materially improved:** 43 unit/adversarial tests pass, including 256 fuzz runs; explicit real Base and Robinhood fork suites pass for both launch modes.

Production deployment blocks:

- Base Bond market: `0xb503b0ef06ec10554f4d960e08869877a41498dd` at block `48642000`; Direct factory: `0xa0dec41a566715288cd8536c78edeb7aa439a29f` at block `48642008`.
- Robinhood Bond market: `0x2d6d77652facbbcae05c0dc3aed792b94cd61fa8` at block `9943107`; Direct factory: `0xc4b8ec8839d3141aa5f7816eb181076a34725734` at block `9943321`.

## Critical findings

### C-01: Direct launch locks only 6.25% of supply in the actual LP position

**Impact:** The Direct product advertises a 1 billion-token locked curve, but the deployed configuration puts only about 62.5 million tokens into Uniswap v4; approximately 937.5 million tokens are stranded in the locker outside the position.

`DirectDexLiquidityLocker` calculates liquidity using `sqrtPriceLowerX96` and `sqrtPriceUpperX96` at `DirectDexLiquidityLocker.sol:161`, but the minted position uses `tickLower` and `tickUpper` at `DirectDexLiquidityLocker.sol:171`. The same `sqrtPriceUpperX96` is also used as the pool's initial price at `DirectDexLiquidityLocker.sol:159`. The deployment config's upper sqrt price corresponds to an initial tick around 254654, while the configured position upper tick is 199200 (`DeployDirectBaseMainnet.s.sol:61-69` and `DeployDirectRobinhoodMainnet.s.sol:51-59`). These are not the same range endpoint.

A real Base fork trace showed:

- Total supply delivered to locker: `1,000,000,000` tokens.
- Tokens transferred into PoolManager for the LP position: approximately `62,500,000` tokens.
- Locker token balance remaining after mint: approximately `937,500,000` tokens.

The existing test only asserts non-zero liquidity (`DirectV4LockerFork.t.sol:38-42`) and therefore misses this economic invariant.

**Required fix before public Direct launch:**

1. Split `initialSqrtPriceX96` from range-bound values.
2. Derive the range square-root prices from `tickLower` and `tickUpper` using the canonical Uniswap TickMath implementation; do not accept independent, potentially inconsistent range values.
3. Assert after mint that the locker residual is at most an explicitly documented rounding dust amount.
4. Add Base and Robinhood fork assertions for the exact token amount deposited and residual balance.
5. Redeploy both Direct factories and lockers. The current deployments have zero launches and should not be retained as production defaults.

## High findings

### H-01: Permissionless pool pre-initialization can block Direct launch and permanently freeze Bond graduation

Uniswap v4 pool initialization is permissionless. An `eth_call` simulation against both configured PositionManagers confirmed that a pool can be initialized for an address with no token bytecode deployed.

For Direct, a token address is predictable from public transaction calldata. An attacker can initialize its exact no-hook pool at the wrong price before the launch transaction executes. `_ensurePool` then reverts with `InvalidPoolState` (`DirectDexLiquidityLocker.sol:266-279`). The existing unit test explicitly confirms that this makes the launch revert (`DirectDexLaunchpad.t.sol:134-142`).

For Bond, the token exists throughout the bonding period. An attacker can initialize all four candidate no-hook pools at unsafe prices. `_selectPool` tries only four candidates and then reverts (`UniswapV4LiquidityLocker.sol:288-311`). Once the launch reaches `graduationReady`, curve trading is closed (`BondingCurveMarket.sol:184-212`) and the emergency path also rejects a ready launch (`BondingCurveMarket.sol:370-415`). ETH and tokens can therefore become permanently stuck.

**Required fix:** Use a platform-controlled Uniswap v4 hook that restricts or validates pool initialization, or design an atomic reservation/initialization mechanism that attackers cannot preempt. A finite public list of fallback fee tiers increases attack cost but does not solve the problem. Add an explicit graduation recovery state machine that never transfers user reserves to an arbitrary treasury and permits safe retry/migration.

### H-02: Launch calldata can be copied to steal permanent creator attribution

The creator-provided salt is not bound to `msg.sender` by the launch contract. Direct checks only the raw salt (`DirectLaunchFactoryBase.sol:88-95`), and both ERC20 factories use that raw salt for CREATE2 (`DirectErc20LaunchFactory.sol:17-35`, `Erc20LaunchFactory.sol:65-103`). The B20 factories similarly pass the raw salt while the B20 factory's deployer is the shared launch factory, not the end user (`DirectB20LaunchFactory.sol:47-71`, `LaunchFactory.sol:97-156`).

An attacker observing a pending create transaction can copy the metadata and salt, pay a higher priority fee, launch first, and become the recorded creator. The victim transaction then reverts due to the consumed salt/CREATE2 collision. The attacker receives the creator's perpetual fee attribution.

The frontend salt is only a hash of name, symbol, and local time (`apps/web/src/app/launch/page.tsx:64`), but changing frontend salt generation alone cannot fix copied calldata.

**Required fix:** Derive the effective deployment salt onchain from at least `msg.sender`, chain context, and the user nonce, and update prediction APIs accordingly. Add a deadline and, if relayed launches are needed, an EIP-712 creator signature. Add adversarial tests in which a second account copies identical calldata.

### H-03: Bond owner can drain an ungraduated launch reserve after 48 hours

`scheduleEmergencyClose` and `emergencyCloseUnbonded` allow the market owner to send the entire real ETH reserve to any recipient (`BondingCurveMarket.sol:370-415`). Token holders receive no automatic pro-rata refund and are left with non-tradable tokens after closure.

Onchain checks found no currently scheduled emergency close for Base launch 22 or Robinhood launch 1. However, both current Bond market owners are single-key EOAs:

- Base: `0x9d5f55a644eF0eB9FF82dbd14Dd0471de3ff5bfb`
- Robinhood: `0xd5bc4D80797ddAEBd91282659Eb79ABaf659B47C`

**Required mitigation for existing deployments:** Transfer market ownership to a well-secured multisig/timelock with public monitoring immediately, or permanently disable the owner capability after deciding that emergency recovery is not required. A multisig reduces key-compromise risk but does not remove the trust assumption.

**Required fix for a future market:** Replace arbitrary-recipient reserve withdrawal with a permissionless cancellation/refund mechanism based on each holder's redeemable curve position. Emergency actions should preserve user claims and should not allow treasury seizure.

## Medium findings

### M-01: Direct users do not commit to the launch configuration they sign under

The owner can update the Direct pool fee, tick range, initial price, and fee split immediately (`DirectLaunchFactoryBase.sol:115-121`). `createLaunch` accepts only metadata and reads the mutable config during execution (`DirectLaunchFactoryBase.sol:78-113`). A config transaction ordered before a pending create can silently change future-launch economics; the user supplied no expected config hash or deadline.

Both Direct factory owners are currently EOAs. Current onchain values are 1% pool fee and 70/30 platform/creator split, and existing positions snapshot their configuration, so later changes cannot alter an already created position.

**Required fix:** Require `expectedConfigHash` and `deadline` in `createLaunch`, revert on mismatch, use a multisig plus timelock for config changes, and have the UI show the exact onchain configuration included in the signed transaction.

### M-02: Fork tests silently pass without executing their assertions

The default `forge test` reports all 38 tests passing, but four fork tests return immediately unless the test chain ID is already Base or Robinhood (`BaseV4LockerFork.t.sol:20-21`, `BaseV4LockerFork.t.sol:48-49`, `RobinhoodV4LockerFork.t.sol:19-20`, `DirectV4LockerFork.t.sol:21-22`). Their default gas usage is only around 164-214 gas, demonstrating the no-op.

When explicitly run against live RPC forks, all five applicable tests passed:

- Base: 3/3.
- Robinhood: 2/2.

**Required fix:** Separate unit and fork profiles, make missing fork configuration a visible skip/failure in CI, and add required Base/Robinhood fork jobs. Do not count early-return tests as security evidence.

### M-03: There are no fuzz or stateful invariant tests

The current suite has no `testFuzz` or invariant handlers. This leaves reserve solvency, buy/sell rounding, fee conservation, graduation liveness, and cross-position fee accounting underexplored.

**Required tests:**

- `contract ETH balance >= sum(realEthReserve) + sum(pendingFees)` across randomized buys, sells, claims, and graduation.
- Fixed total supply and no post-launch mint authority.
- Position liquidity never decreases through any public locker call.
- All collected fees equal platform plus creator pending/claimed amounts, allowing only documented rounding.
- Direct LP consumes the intended supply, with residual bounded to dust.
- Every `graduationReady` state has a successful bounded path to graduation or user refunds.
- Copied-calldata and pool-pre-initialization adversarial scenarios.

## Low and operational hardening

### L-01: Single-step ownership transfers

The custom `Ownable` transfers ownership in one transaction (`contracts/src/access/Ownable.sol:23-27`). A typo permanently loses control. Use a two-step ownership transfer and multisig owners for mutable production controls.

### L-02: Bond metadata has no length bounds

Bond factories require non-empty strings but do not cap lengths (`LaunchFactory.sol:109-113`, `Erc20LaunchFactory.sol:80-83`). The sender bears gas, so this is mainly an indexing/UI griefing risk. Apply the same explicit name/symbol/URI limits used by Direct and cap URI bytes.

### L-03: Static analysis coverage is limited

Foundry build/lint completed and contract sizes are comfortably below EVM limits. Lint reported type-cast warnings, but the reviewed casts are bounded by current fixed supply or explicit pre-cast checks. Slither, Echidna/Medusa, and symbolic execution are not installed/configured in this repository. Run at least Slither plus stateful fuzzing after the critical redesign and before redeployment.

## Positive controls verified

- No production locker exposes an LP-NFT transfer or principal-withdrawal function.
- Fee collection verifies that recorded position liquidity is unchanged (`DirectDexLiquidityLocker.sol:200-220`, `UniswapV4LiquidityLocker.sol:219-240`).
- Fee claims follow checks-effects-interactions and use a reentrancy guard.
- Direct positions snapshot creator and fee split, so future config changes do not rewrite existing entitlements.
- Base and Robinhood real-fork tests successfully created positions, executed swaps, collected fees, and preserved position liquidity.
- Current Direct launch counts are zero on both networks, allowing safe replacement before public use.
- Current Direct onchain config is 1% pool fee, 70% platform share, 30% creator share, and a 0.002 ETH launch fee.

## Remaining release recommendations

1. Add the explicit Base and Robinhood fork commands to hosted CI so the early-return default fork tests are never treated as fork evidence.
2. Add Slither plus stateful invariant tooling when available; the current 256-run solvency fuzz test is useful but is not a replacement for a long-running invariant campaign.
3. Move both timelock owner and guardian roles from the two deployer EOAs to independent hardware-backed multisigs. Until then, the 48-hour delay and cross-network guardian reduce risk but do not provide multisig key redundancy.
4. Obtain an independent third-party audit before treating the contracts as risk-free. No engineering review can honestly guarantee the absence of every undiscovered vulnerability.
