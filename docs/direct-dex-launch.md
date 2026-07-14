# Direct-to-DEX launch design

## What O1 does

The live O1 launchpad does not use a bonding/graduation threshold. Its current Base and Robinhood Chain factories create a fixed-supply token and a Uniswap v4 pool atomically, seed the pool with token-only liquidity, and keep the launch liquidity permanently locked.

Verified live configuration on both networks on 2026-07-15:

- Fixed supply: `1,000,000,000` tokens with 18 decimals.
- Base swap fee: `1%` (`100` basis points).
- Fee split: 50% creator, 30% platform, 20% referrer.
- Anti-snipe fee window: 16 seconds, with a high temporary starting fee.
- Tick spacing: `200`.
- Native-token launch start tick: `-199200` in O1's token-price frame.
- Launch creation and the pool are created in the same transaction.
- The pool starts token-only. Early buys add quote/native liquidity; a sell can have no executable quote before enough buy-side liquidity exists.

Sources:

- [O1 launchpad](https://launch.o1.exchange/)
- [O1 fee documentation](https://docs.o1.exchange/getting-started/fees)
- [Uniswap v4 periphery](https://github.com/Uniswap/v4-periphery)
- [Uniswap Liquidity Launchpad paper](https://docs.uniswap.org/whitepaper_cca.pdf)

The O1 contracts are not copied or called by BlueFun. Their public interface and live onchain configuration were used to understand the product model.

## BlueFun implementation

BlueFun keeps the existing bond route unchanged and adds an independent direct route for both networks:

- Base: B20 token created through the Base B20 factory.
- Robinhood Chain: fixed-supply `StandardLaunchToken` ERC-20.
- Supply: fixed at 1 billion.
- Pool: Uniswap v4 native/token static-fee pool.
- Swap fee: 1% by default.
- Fee ownership: 70% BlueFun / 30% creator, stored per position forever.
- Liquidity: token-only concentrated-liquidity curve, custody-locked in `DirectDexLiquidityLocker`.
- Principal: no withdrawal, decrease, NFT transfer, or rescue path exists.
- Fees: permissionless realization with a zero-liquidity delta, followed by pull-based beneficiary claims.
- Configuration: owner may change bounded defaults for future launches. Existing positions retain their launch-time fee split and pool parameters.

The default native/token curve uses tick range `[-887200, 199200]`, tick spacing `200`, and initializes at the upper tick. This starts near a low single-digit native-token fully diluted valuation for a 1B/18-decimal supply and lets buys move down the range as token inventory is exchanged for native liquidity.

## Mainnet deployments

Robinhood Chain was deployed and verified onchain on 2026-07-15:

- Factory: `0xde6414a1140f97b4de63462608af79f7b1bbc393`
- Permanent liquidity locker: `0x237b48ca046c49ff59b99142334c3631ebacd757`
- Start block: `9900658`
- Launch fee: `0.002 ETH`
- Pool fee: `1%`
- Fee split: 70% platform / 30% creator

The frontend and Robinhood indexer use these addresses as checked-in defaults. Environment variables may override them when operating a replacement deployment.

## Deployment gate

Base direct mode remains visibly unavailable until its contracts are deployed and the factory, locker, and deployment block variables are configured. Deployment scripts are:

- `contracts/script/DeployDirectBaseMainnet.s.sol`
- `contracts/script/DeployDirectRobinhoodMainnet.s.sol`

Required indexer values:

- `DIRECT_LAUNCH_FACTORY`
- `DIRECT_LIQUIDITY_LOCKER`
- `DIRECT_DEPLOYMENT_BLOCK`

Required web values use the corresponding `NEXT_PUBLIC_BASE_*` and `NEXT_PUBLIC_ROBINHOOD_*` names from `apps/web/.env.example`.

Before a public deployment, the direct contracts require an independent smart-contract audit and a real Uniswap v4 fork test on both target networks. Unit tests prove the intended custody and accounting invariants but are not an audit.
