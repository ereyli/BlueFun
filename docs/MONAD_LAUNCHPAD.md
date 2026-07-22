# Monad launchpad deployment and operations

This document is the source of truth for BlueFun's Monad mainnet rollout. Monad is
chain ID `143`; its native currency is `MON` with 18 decimals. Users pay gas, launch
fees, Bond trades and Direct-market initial buys in native MON.

## Product configuration

| Item | Monad value |
| --- | ---: |
| Token standard | Fixed-supply ERC-20 |
| Supply | 1,000,000,000 tokens |
| Launch fee | 80 MON |
| Bond virtual MON reserve | 100,000 MON |
| Bond graduation target | 400,000 MON gross |
| Maximum first buy | 400,000 MON |
| Buy fee | 0.7% platform MON + 0.3% creator MON |
| Sell fee | 0.7% platform MON + 0.3% token burn |
| Direct initial FDV | approximately 700 MON |
| Platform revenue destination | BlueFun Safe treasury |
| Base staking allocation | 0%; no implicit cross-chain bridge |

The MON parameters are deliberately separate from the ETH-network parameters. They
can be changed later only through the Safe-owned seven-day timelock, within the caps
enforced by `MonadFeePolicy`.

## Governance and revenue

Monad uses the same deterministic Safe address as the other networks:
`0x144A3f70C0bf33124852E3891011e033b909F46d`.

The required final state is exactly three owners with a 2-of-3 threshold, matching
`MULTISIG_SECURITY_AND_MIGRATION.md`. The protocol deployment script refuses to run
if this threshold or owner count is missing. `MonadRevenueRouter` accounts all native
MON platform revenue to the Safe treasury. Creator buy revenue remains pull-based and
can only be claimed by the recorded creator. There is no automatic Monad-to-Base
bridge and no Monad revenue is silently counted as BLUE staking revenue.

Safe rollout order:

1. Run `DeployBlueFunSafeMonad.s.sol` with the gas-funded deployer. It replays the
   recovered initializer and salt and asserts the expected address.
2. Run `ConfigureBlueFunSafeMonad.s.sol` using the existing bootstrap owner key. It
   adds the other two documented owners and raises the threshold to 2.
3. Independently read `getOwners()` and `getThreshold()` from Monad RPC.
4. Only then run `DeployVNextMonadMainnet.s.sol`.

The deployer EOA has no final admin role. The timelock owner is the Safe, the emergency
guardian is separately supplied, and protocol fee income is claimable only to the Safe.

## Official external contracts

The deployment uses Monad's live Uniswap v4 stack:

| Contract | Address |
| --- | --- |
| PoolManager | `0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e` |
| PositionManager | `0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016` |
| StateView | `0x77395F3b2E73aE90843717371294fa97cC419D64` |
| Quoter | `0xa222dd357a9076d1091ed6aa2e16c9742dd26891` |
| Universal Router 2.1.1 | `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Before broadcasting, verify non-empty bytecode at every external address through at
least two RPC endpoints. Monad charges transactions according to their gas limit, so
deployment gas limits must be estimated conservatively without setting unnecessarily
large limits.

## Deployment gates

- Contract unit tests pass.
- Web typecheck and production build pass.
- Indexer TypeScript build passes.
- Monad fork exercises Bond creation/buy/sell/graduation and Direct pool creation.
- Safe bytecode, owners and threshold are verified on chain.
- Deployment simulation produces deterministic hook flags and no revert.
- Broadcast receipts and deployment block are recorded under `contracts/deployments/`.
- Web and indexer environment variables are populated only from confirmed receipts.
- A live smoke launch verifies native MON fees and Safe treasury claim accounting.

## Production deployment

Deployed at block `89311403`; Direct factory deployed at block `89311452`.
Canonical addresses and transaction receipts are recorded in
`contracts/deployments/vnext-monad-mainnet.json`. Live canaries completed Bond and
Direct initial buys and sells, exact sell-burn accounting, creator claims and a
`160.017454624808197361 MON` platform-revenue claim to the Safe.

After testing, `35 MON` of unused deployment capital was swept to the Safe in
transaction `0x2e5737c24859b1b0b8e59a3a15fbabcc360fb2112268dbc2640d0077cde88d22`.
The deployer retained approximately `1.815 MON` only for future operational gas. The
encrypted keystore is gitignored and its password is stored in the local macOS
Keychain; neither secret is present in repository files.

## References

- Monad network changelog: <https://docs.monad.xyz/developer-essentials/changelog>
- Safe multi-chain deployment: <https://docs.safe.global/advanced/smart-account-multi-chain-deployment>
- Safe contract deployment: <https://docs.safe.global/core-api/safe-contracts-deployment>
- Uniswap v4 periphery: <https://github.com/Uniswap/v4-periphery>
- Uniswap Universal Router deployments: <https://github.com/Uniswap/universal-router/tree/main/deploy-addresses>
