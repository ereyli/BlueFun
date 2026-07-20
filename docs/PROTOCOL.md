# BlueFun protocol and operations reference

Status: production vNext active on Base and Robinhood Chain

Last reviewed: 16 July 2026

Canonical deployment catalog: [`contracts/deployments/secure-mainnet.json`](../contracts/deployments/secure-mainnet.json)

This is the canonical technical and operational reference for BlueFun. Read and update this file before changing contracts, launch economics, deployment addresses, the indexer catalog, staking, or the production web configuration. Historical token support is part of the production system and must not be removed during a future upgrade.

## 1. Source-of-truth order

When two files disagree, use this order:

1. Deployed contract bytecode and current onchain state.
2. [`contracts/deployments/secure-mainnet.json`](../contracts/deployments/secure-mainnet.json).
3. `apps/web/src/lib/contracts.ts` and `apps/indexer/src/deployment.ts`.
4. This document.
5. User-facing copy and older release notes.

No private key, RPC secret, database credential, Pinata token, or service-role key belongs in Git. Public contract addresses may be committed.

## 2. Product architecture

BlueFun is a multichain token launch, discovery and trading platform with two active networks:

| Network | Chain ID | Launch token standard | DEX |
| --- | ---: | --- | --- |
| Base | 8453 | B20 `ASSET` | Uniswap v4 |
| Robinhood Chain | 4663 | Fixed-supply ERC-20 | Uniswap v4 |

Both networks support:

- Bond launches with bonding-curve price discovery and Uniswap v4 graduation.
- Direct DEX launches that create a Uniswap v4 pool immediately.
- Fixed supply of 1,000,000,000 tokens.
- Zero free creator allocation.
- Optional creator first buy in the atomic launch transaction.
- Permanently locked LP principal.
- A shared vNext fee policy for Bond, Direct and graduated Bond pools.

BLUE staking exists only on Base. Robinhood revenue intended for BLUE staking accumulates in a bridge reserve and is transferred to Base manually.

## 3. Current launch routes

### 3.1 Bond launch

1. The factory creates the token and registers it with the active BondingCurveMarket.
2. The complete launch supply is controlled by the market; the creator receives no free allocation.
3. Users buy and sell against virtual reserves.
4. The current gross graduation target is 5 ETH.
5. When the target is reached, curve trading becomes graduation-ready.
6. Remaining tokens and real ETH reserves enter the permanent Uniswap v4 locker.
7. After graduation, the same vNext hook continues the current fee and burn rules.

Bond constants currently used by both networks:

| Parameter | Value |
| --- | ---: |
| Supply | 1,000,000,000 tokens |
| Virtual token reserve | 1,000,000,000 tokens |
| Virtual ETH reserve | 1.25 ETH |
| Gross graduation target | 5 ETH |
| Creator allocation | 0% |
| Per-wallet cap | 900,000,000 tokens |
| Anti-sniping duration | 60 seconds |
| Anti-sniping maximum buy | 500,000,000 tokens |
| Optional launch-time first buy | 0 to 5 ETH |

### 3.2 Direct DEX launch

1. The factory creates the token, its Uniswap v4 pool and its locked position atomically.
2. All 1 billion tokens begin as token-only liquidity.
3. The creator may launch with no first buy.
4. If a first buy is supplied, the contract rejects it when the creator would receive more than 50,000,000 tokens, equal to 5% of supply.
5. Early buys add ETH depth and move the pool price.

A token-only pool may not support a meaningful sell before buy-side ETH depth exists. This is expected market behavior, not withdrawable LP. Aggregators may also take time to discover a new custom-hook pool even when BlueFun routing already works.

## 4. vNext fee policy

The active FeePolicy begins with:

| Action | Platform | Creator | Burn | Total user-side policy |
| --- | ---: | ---: | ---: | ---: |
| Buy | 0.7% ETH | 0.3% ETH | none | 1.0% |
| Sell | 0.7% ETH output | none | 0.3% token input | 1.0% |

Important rules:

- Creator revenue exists only on buys.
- Sell burn is sent to `0x000000000000000000000000000000000000dEaD` during the transaction.
- Only 0.3% of sell token input is burned; the full sell amount is not burned.
- The Uniswap v4 LP fee is overridden to zero, preventing a second fee on top of the protocol policy.
- Supported vNext swaps are exact-input swaps.
- Exact-output paths are rejected by UnifiedFeeHook.
- Creator ETH is pull-based and can be claimed only by the creator recorded for that pool.
- Pool-to-token-to-creator registration is one-time and cannot be replaced.

FeePolicy bounds:

| Setting | Initial value | Onchain bound |
| --- | ---: | ---: |
| Buy platform + creator fee | 1.0% | maximum 2.0% total |
| Sell platform + burn fee | 1.0% | maximum 2.0% total |
| Launch fee | 0.001 ETH | maximum 0.01 ETH |
| Trade staking share | 50% | maximum 100% |
| Launch staking share | 0% | maximum 100% |

Changes require the governance path described below. A fee change affects vNext contracts reading the shared policy; it does not rewrite the behavior of legacy deployments.

## 5. Revenue routing

### 5.1 Base

Current vNext trade platform ETH is split automatically:

- 50% to BLUE Staking V2.
- 50% to the Base treasury balance.

Current launch fees are routed 100% to treasury because `launchStakingShareBps` begins at zero.

Revenue manually bridged from another network enters through `depositBridgedStakerRevenue`. It is credited 100% to stakers and is not split a second time.

The router uses pull accounting for treasury revenue. A temporarily unavailable staking vault does not block swaps; staker revenue remains queued for a later flush.

### 5.2 Robinhood Chain

Current vNext trade platform ETH is split automatically:

- 50% to Robinhood treasury accounting.
- 50% to the fixed bridge reserve.

The bridge reserve can only be released to the configured recipient. The actual cross-chain transfer is manual; BlueFun does not depend on a third-party bridge contract. After bridging to Base, deposit the funds using the Base router's bridged-staker entry point so they are not split again.

## 6. BLUE and BLUE Staking V2

Official BLUE token:

| Field | Value |
| --- | --- |
| Network | Base |
| Standard | B20 `ASSET` |
| Token | `0xb200000000000000000000Af2d07754b927109bc` |
| Supply | 1,000,000,000 BLUE |
| Original launch generation | Legacy Base Bond |
| Original launch ID | 3 |

BLUE predates vNext. Its trading route continues to use its original launch contracts. BLUE can still be the staking principal for the new V2 vault without migrating or replacing the token.

Staking V2 behavior:

- Staking is Base-only.
- Principal is BLUE; rewards are native ETH.
- Rewards stream over seven days.
- Rewards are distributed pro rata by active BLUE stake.
- Revenue received with no active stakers is queued.
- Unstake cooldown is 30 days.
- Additional unstake requests add to the pending amount and restart the 30-day timer for the entire pending balance.
- Partial cancellation and partial matured withdrawal are supported.
- Claims and matured withdrawals remain available when new staking or reward funding is paused.
- Accounted rewards and stake principal cannot be recovered as admin surplus.
- Emergency exit is irreversible and removes cooldown waiting; it does not transfer user funds to administration.

Legacy staking used WETH and a different vault. It is not the active default. Do not enable its emergency-exit migration until the production V2 interface and a real user withdrawal are verified.

## 7. Liquidity custody and hook security

The vNext lockers deliberately provide no path for the creator, treasury, guardian, deployer or timelock to withdraw LP principal or transfer the position NFT.

UnifiedFeeHook security properties:

- Hook permission bits are encoded in the CREATE2 address.
- Only frozen, allowed lockers can authorize pools.
- Pool initialization must match the pre-authorized pool identity and initial price.
- Pool registration cannot be overwritten.
- Callback access is restricted to the canonical PoolManager.
- Reentrancy protection covers creator claims.
- Exact-output swaps are rejected.
- LP fee override prevents duplicate fees.

"LP locked" protects position custody. It does not guarantee token value, adequate liquidity, price stability, aggregator support, RPC availability or defect-free code.

## 8. Governance, pausing and maintenance

Each network has its own seven-day StakingTimelock. Fee and configuration changes execute only after the delay. The guardian may cancel a queued malicious or incorrect operation and may pause new launches. Only delayed governance can unpause new launches.

Contract pause and website maintenance are separate controls:

- `FeePolicy.pauseNewLaunches()` stops new vNext creation on that network but does not stop existing token trading.
- `SITE_MAINTENANCE_MODE=true` replaces every web page with the maintenance screen after the web is redeployed.
- Website maintenance does not pause contracts, indexers or onchain trading.
- Return `SITE_MAINTENANCE_MODE=false` and redeploy to restore the interface.

There is intentionally no public unauthenticated HTTP endpoint that can enable maintenance mode.

## 9. Active vNext contracts

### 9.1 Base mainnet

Deployment block: `48678791`

First vNext Bond launch ID: `23`

First vNext Direct launch ID: `2`

| Component | Address |
| --- | --- |
| Governance timelock | `0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26` |
| FeePolicy | `0xe5c5585aB34F8e2ba55C30Ef5E6b0254d87a4941` |
| BaseRevenueRouterV2 | `0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741` |
| BLUE Staking V2 vault | `0x221a86096a334BcaFd5E561564dC8E6A48F19584` |
| UnifiedFeeHook | `0xF0b8dDe19510eE7D6D50Be289C4257EcD14C60CC` |
| Bond emergency guardian | `0x642592CF4DA396a2d70b930E43B45E108cC37803` |
| BondingCurveMarket | `0x7d42dd1435e9567C1edFb513C45c8eA82fe03a38` |
| Bond LP locker | `0x484345C0Fc777d1945a84ADB6284D487daFB1de8` |
| Graduation manager | `0x989bd9259408F73BB17099d37Df2CCdC57B271f3` |
| Bond factory | `0x820344FB4C0a518d0CaEf5d3De96fF41CBe6b345` |
| Direct LP locker | `0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7` |
| Direct factory | `0x394c5D0244b49e1Eed533CD3505583e504589157` |

All deployment contracts are source-verified on BaseScan.

### 9.2 Robinhood Chain

Deployment block: `10703400`

First vNext Bond launch ID: `2`

First vNext Direct launch ID: `1`

| Component | Address |
| --- | --- |
| Governance timelock | `0xa64ed8d4C4cAcFF075A4D1d50EE2F7795B4B0039` |
| FeePolicy | `0x4D0baaCfb8267C8f7ca39756Bb29f924dDd72a6a` |
| RemoteRevenueRouter | `0xF42f51728ddffF6B4a556175DC5E5b68a1e5371B` |
| UnifiedFeeHook | `0x4C77A461669c0345960dD33d415747c8932F60cC` |
| Bond emergency guardian | `0xddEE46479e7fC31a556bac34A318C423c66F353F` |
| BondingCurveMarket | `0x2F46a783C1314e160d673F927464d85B7364D807` |
| Bond LP locker | `0x1122c6caB7520278f82928Fef1e35448419523B2` |
| Graduation manager | `0x781b14110cd3A9377896722Bd9844c26d338e251` |
| Bond factory | `0x32af28dfE63ff9e84399f0af51d5B84b4f3B3c62` |
| Direct LP locker | `0x8550c8f626993Ffb58A884CB4E9B5b8A9Ee2bDF6` |
| Direct factory | `0x7De3165634679353a36886DCfe35e3521beee4A4` |

All vNext contracts are source-verified on Robinhood Blockscout.

## 10. Legacy-token compatibility

### 10.1 Non-negotiable compatibility rule

A new factory affects only future launches. Existing tokens are not migrated automatically and must continue using the exact contracts and economic rules active when they launched.

The web and indexers identify a token using network plus deployment scope, not launch ID alone. The same numeric launch ID may exist in multiple generations. Never replace historical addresses with vNext addresses in existing rows.

Expected routing:

- Historical Bond token still bonding: original BondingCurveMarket.
- Historical Bond token graduated: its original Uniswap v4 pool and hook/locker behavior.
- Historical Direct token: its original Direct factory/locker/pool behavior.
- vNext Bond token before graduation: vNext BondingCurveMarket.
- vNext Bond token after graduation: vNext UnifiedFeeHook pool.
- vNext Direct token: vNext UnifiedFeeHook pool.

Legacy tokens remain visible, tradable and indexed. They must not be labelled as having vNext burn, staking routing or creator-buy-only revenue unless their original contracts actually implement those rules.

### 10.2 Indexed Bond generations

| Network | Generation | Factory | Market | Start block |
| --- | --- | --- | --- | ---: |
| Base | legacy | `0xf65ebfdacb1a8e0a8217185aae44f489e53b88f9` | `0x4ce2154146eacf745133d7755875767d6a00ee5f` | 48379352 |
| Base | fee-sharing-v1 | `0x29ce28c9cb3f584eb2548883824acd49881e780a` | `0x94d056be6573bcaa4958cceeb242c3c08eff2b95` | 48451170 |
| Base | current pre-vNext | `0x830569db6364f22cfb5eaa8a0ce17b1382ed3436` | `0xb503b0ef06ec10554f4d960e08869877a41498dd` | 48642000 |
| Base | vNext | `0x820344fb4c0a518d0caef5d3de96ff41cbe6b345` | `0x7d42dd1435e9567c1edfb513c45c8ea82fe03a38` | 48678791 |
| Robinhood | legacy | `0x6a05304638bed7c96b78f420c612e84111fad4d1` | `0xab7597fecaf3357101a3a4331f512031ef3238f0` | 5576234 |
| Robinhood | fee-sharing-v1 | `0x128a32ed2af1787a3fab261bc6158400e2f649c9` | `0x795fe5649a78496f51c1594a7b435941fb20adb8` | 6131828 |
| Robinhood | current pre-vNext | `0xb880ea1d3453968243722b9c1529870c796b060f` | `0x2d6d77652facbbcae05c0dc3aed792b94cd61fa8` | 9943107 |
| Robinhood | vNext | `0x32af28dfe63ff9e84399f0af51d5b84b4f3b3c62` | `0x2f46a783c1314e160d673f927464d85b7364d807` | 10703400 |

### 10.3 Indexed Direct generations

| Network | Generation | Factory | Locker | Start block |
| --- | --- | --- | --- | ---: |
| Base | pre-vNext | `0x0246688cef66734c1cada909cfd202e1448ba275` | `0x2e83029d88d0af58ba55b31980dc709920fab941` | 48647525 |
| Base | vNext | `0x394c5d0244b49e1eed533cd3505583e504589157` | `0x857f7d11474235d8cafd79826d4d2e0d2b7dabd7` | 48678791 |
| Robinhood | pre-vNext | `0x9d0e5d76ca2d79ca6ab0c800763eb8e5c39a5079` | `0xe0158cb5c659e95e0ef461e1f7518c4f3b557e81` | 10283960 |
| Robinhood | vNext | `0x7de3165634679353a36886dcfe35e3521beee4a4` | `0x8550c8f626993ffb58a884cb4e9b5b8a9ee2bdf6` | 10703400 |

## 11. Web and indexer behavior

### 11.1 Web

- `apps/web/src/lib/contracts.ts` contains the runtime deployment catalog.
- New creation uses vNext only.
- Historical deployments remain available to reads and token routing.
- Contract overrides exist only for selected public addresses; removing an override falls back to the committed catalog.
- Staking overview is read directly from Base by `apps/web/src/lib/blue-staking.ts`; it is not supplied by the launch indexer.

### 11.2 Indexers

Run one indexer process for Base and a separate process for Robinhood.

- `apps/indexer/src/deployment.ts` includes every supported Bond generation.
- Each generation gets a unique scope containing chain, factory, market and start block.
- Direct generations also receive separate scopes.
- Legacy and vNext rows may share a database because the scope prevents collisions.
- Never reset a scope checkpoint to another deployment's block.

Required Direct overrides for the active processes:

Base:

```env
CHAIN_ID=8453
DIRECT_LAUNCH_FACTORY=0x394c5D0244b49e1Eed533CD3505583e504589157
DIRECT_LIQUIDITY_LOCKER=0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7
DIRECT_DEPLOYMENT_BLOCK=48678791
```

Robinhood:

```env
CHAIN_ID=4663
DIRECT_LAUNCH_FACTORY=0x7De3165634679353a36886DCfe35e3521beee4A4
DIRECT_LIQUIDITY_LOCKER=0x8550c8f626993Ffb58A884CB4E9B5b8A9Ee2bDF6
DIRECT_DEPLOYMENT_BLOCK=10703400
```

Bond addresses are committed in the indexer catalog and currently have no environment override. Adding invented Bond environment variable names has no effect.

## 12. Public web environment values

Current public deployment values:

```env
SITE_MAINTENANCE_MODE=false

NEXT_PUBLIC_BLUE_STAKING_GOVERNANCE=0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26
NEXT_PUBLIC_BLUE_REVENUE_ROUTER=0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741
NEXT_PUBLIC_BLUE_STAKING_VAULT=0x221a86096a334BcaFd5E561564dC8E6A48F19584
NEXT_PUBLIC_BLUE_STAKING_DEPLOYMENT_BLOCK=48678791

NEXT_PUBLIC_BASE_DIRECT_LAUNCH_FACTORY=0x394c5D0244b49e1Eed533CD3505583e504589157
NEXT_PUBLIC_BASE_DIRECT_LIQUIDITY_LOCKER=0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7
NEXT_PUBLIC_BASE_DIRECT_DEPLOYMENT_BLOCK=48678791

NEXT_PUBLIC_ROBINHOOD_DIRECT_LAUNCH_FACTORY=0x7De3165634679353a36886DCfe35e3521beee4A4
NEXT_PUBLIC_ROBINHOOD_DIRECT_LIQUIDITY_LOCKER=0x8550c8f626993Ffb58A884CB4E9B5b8A9Ee2bDF6
NEXT_PUBLIC_ROBINHOOD_DIRECT_DEPLOYMENT_BLOCK=10703400
```

`NEXT_PUBLIC_ROBINHOOD_VNEXT_ENABLED` no longer exists and must be removed from production environments.

## 13. Verification and live smoke evidence

The release gate completed with 74 Foundry tests, including fuzz and stateful invariant suites. Production builds, lint, type checking and JSON validation passed. No technical process can guarantee that a contract is defect-free; the release standard is no known high/critical finding plus passing test, fork, verification and controlled live-smoke gates.

Base live smoke:

| Route | Launch | Token | Create transaction | Sell transaction |
| --- | ---: | --- | --- | --- |
| Bond | 23 | `0xb2000000000000000000003e9c47db410ad246b1` | `0x5e13f071c84e6a3fb41abca17b5f99b5b9603b4ca362b4454daac9fcb0734d39` | `0x5cea97f5499b7c9ed85c443830d78e42938a37c3caaacd6ed4d35ccfbcebfebd` |
| Direct | 2 | `0xB20000000000000000000006655b4DeB2144ED87` | `0x91c74fc4d1c410851a959efc541ee95648efa0d9f1296009656d015c8898ba72` | `0xed059b29976ef53ee2a63ef5ed234e5246bbd1edd984e91816e1d415ec4aa91e` |

Robinhood live smoke:

| Route | Launch | Token | Create transaction | Sell transaction |
| --- | ---: | --- | --- | --- |
| Bond | 2 | `0xa5aaB3A2552f9D456141E1FdF2f0EF6FB5B48c0F` | `0xb8624ba3f3132d7cb66dac0d0ff74a15c7def487ac671ff92222a7c823844422` | `0x508e5ef7553b7ae4dd503344fa4a47370b1eeeac0832ca0865095b33865dba61` |
| Direct | 1 | `0x8d735a9003069480498e5c64ab237e7e98e421d2` | `0x7e74d02effeafdb01c87f8a202c2145a598b49fbb2bac8d16c0670807c58d446` | `0xb75c18e7d3cc1c92818466a6a87ca077df30e750a0785a6d5dc34ad4da78f883` |

The smoke sequence verified token creation, optional creator buy, Bond sell, Direct sell through Permit2 and Universal Router, exact 30 bps dead-wallet burn, creator buy revenue, Base staking/treasury routing, and Robinhood treasury/bridge-reserve routing.

## 14. Known operational constraints

- Custom-hook pools may not appear immediately in Uniswap's public interface or third-party aggregators.
- Low ETH depth can prevent a sell quote even though the pool exists.
- Quoters, RPC providers and indexers can fail independently of contract state.
- A token allowance and a Permit2 allowance are separate approvals when the route requires both. Existing sufficient allowances should be reused.
- Buy/sell controls must clear pending and success state after transaction completion so the user does not need to refresh.
- Onchain transactions are irreversible. UI success must be based on a confirmed receipt, not only a submitted hash.

## 15. Required procedure for future changes

Before changing economics or deploying another generation:

1. Read this file, the deployment catalog, web catalog and indexer catalog.
2. Record the intended change and explicitly state whether it affects only future launches or existing vNext contracts through shared policy.
3. Preserve every historical deployment scope.
4. Add a new version instead of overwriting old addresses.
5. Seed launch counters from current live counts immediately before deployment.
6. Run unit, fuzz, invariant, fork and static-analysis gates.
7. Deploy with keys kept only in ignored local secret files.
8. Verify every new contract on the correct explorer.
9. Execute low-value Bond and Direct smoke launches, including buy, sell, burn and revenue assertions.
10. Update `secure-mainnet.json`, web contracts, indexer deployments, environment examples, the site Docs page and this file in the same change.
11. Deploy web and both indexers together when catalogs change.
12. Confirm new launches use the new generation while historical tokens still load and trade through their original generation.
13. Update the reviewed date and live evidence in this document.

The NFT launchpad is intentionally V3-only. Web and indexer catalogs reject superseded NFT factories and markets;
historical contracts remain visible only through their public chain history.

## 16. Release commands

```sh
forge test
forge build --sizes
npm run lint -w apps/web
npm run typecheck -w apps/web
npm run build:all
jq empty contracts/deployments/secure-mainnet.json
git diff --check
```

For contract changes, also run the relevant Base and Robinhood fork suites and the configured static analyzer. A web-only pass is not sufficient for protocol changes.
