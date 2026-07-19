# BlueFun Arc launchpad

Status: source and local tests prepared; not deployed

Arc public mainnet documentation, explorer endpoints and official Uniswap v4
addresses must be verified before broadcast. The currently known private RPC is
not sufficient evidence for a production activation.

## Economics

Arc uses USDC as its native EVM currency. Contract values use the native
18-decimal representation, so `1 ether` in the Arc-only contracts means 1 USDC,
not 1 ETH.

| Parameter | Arc value |
| --- | ---: |
| Launch fee | 2 USDC |
| Permanent launch-fee ceiling | 25 USDC |
| Bond virtual token reserve | 1,000,000,000 tokens |
| Bond virtual USDC reserve | 1,250 USDC |
| Bond gross graduation target | 5,000 USDC |
| Token supply | 1,000,000,000 tokens |
| Creator allocation | 0% |
| Buy platform fee | 0.7% USDC |
| Buy creator fee | 0.3% USDC |
| Sell platform fee | 0.7% USDC output |
| Sell burn | 0.3% token input |
| Trade platform revenue reserved for Base staking | 50% |

The launch fee can change only through governance and can never exceed 25 USDC
in this contract generation. The seven-day timelock also controls adapter
staging, fee shares, treasury addresses and launch activation.

## Deployment phases

### Phase 1: paused Arc core

`DeployArcMainnet.s.sol` deploys:

- seven-day `StakingTimelock`;
- `ArcFeePolicy`, starting with new launches paused;
- native-USDC `ArcRevenueRouter`;
- `ArcDexAdapterRegistry` with no adapters configured;
- `ArcBondingCurveMarket` and `ArcGraduationCoordinator`;
- `ArcBondLaunchFactory` and `ArcDirectLaunchFactory`.

Neither factory can create a token merely because the website is enabled. Bond
creation requires a frozen Bond adapter, Direct creation requires a frozen
Direct adapter, and both also require the shared policy to be unpaused.

### Phase 2: official DEX integration

After Arc and the DEX publish verified production addresses:

1. Implement the adapter against the official PoolManager, PositionManager,
   StateView, Permit2 and router contracts.
2. Use a non-upgradeable adapter and a permanent-liquidity locker with no LP
   principal withdrawal or position-NFT transfer path.
3. Run Arc fork tests for pool initialization, exact-input buy, sell, 30 bps
   burn, fee routing, graduation and LP-principal invariants.
4. Schedule the adapter and approved Direct configuration hash through the
   seven-day timelock.
5. Freeze the adapters only after the delay and verification complete. Freezing
   is irreversible for this contract generation.
6. Schedule `unpauseNewLaunches()` through the timelock.
7. Execute low-value Bond and Direct smoke launches before enabling the web.

If the verified DEX integration needs to change after freezing, deploy a new
BlueFun contract generation. Do not make the frozen adapter replaceable and do
not point the registry to an upgradeable proxy.

## User-interface requirements

- Display every quote, reserve, volume and platform fee as USDC, never ETH.
- Arc native USDC uses 18-decimal EVM value units; the optional ERC-20 interface
  uses 6 decimals. Do not mix the two representations in one calculation.
- Reserve estimated native USDC gas before offering a Max buy.
- Show Bond and Direct launch actions as unavailable until their corresponding
  adapter is frozen and the shared launch pause is lifted.
- Do not display "LP locked" before a confirmed graduation or Direct position.

## Deployment gate

Before broadcasting:

- confirm chain ID, canonical RPC and explorer from Arc's public documentation;
- confirm the native USDC behavior with a low-value transfer;
- confirm the deployer has enough USDC for deployment and smoke tests;
- run `forge test`, `forge build --sizes` and static analysis;
- simulate `DeployArcMainnet.s.sol` against an Arc fork;
- record every address and deployment block without changing Base or Robinhood
  history;
- add a separate Arc indexer process and Arc deployment scope;
- deploy the web and indexer catalog changes together only after smoke tests.

## Arc Testnet validation

The isolated Arc Testnet stack was deployed on chain `5042002` on 2026-07-18.
All 18 deployment/configuration transactions and all six live smoke-test
transactions succeeded. The smoke test created one Bond token and one Direct
token, bought both with native USDC, approved both trading contracts, sold half
of each acquired balance, routed platform and creator fees, and verified the
configured token burn.

The deployed `ArcTestnetDexAdapter` is a non-withdrawable constant-product test
adapter used only to exercise the deferred DEX boundary. It is not Uniswap, is
not approved for Arc Mainnet, has its callers permanently frozen and has no
owner. The full 5,000 USDC graduation flow is covered by automated tests; it was
not funded on the public testnet.

Canonical addresses and transaction hashes are recorded in
`contracts/deployments/arc-testnet.json`.
