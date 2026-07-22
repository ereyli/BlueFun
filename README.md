# BlueFun Launchpad

BlueFun is a multichain launchpad for Base-native B20 `ASSET` tokens and fixed-supply ERC-20 tokens on Robinhood Chain and Monad. It supports fair Bond launches and immediate Uniswap v4 Direct DEX launches while retaining read-only compatibility with historical deployments.

## vNext protocol

- Fixed launch supply: 1 billion tokens.
- Launch fee: `0.001 ETH` by default, bounded onchain to `0.01 ETH`.
- Buy fee: `0.7%` platform ETH plus `0.3%` creator ETH.
- Sell fee: `0.7%` platform ETH plus `0.3%` of token input sent to `0x0000…dEaD`.
- Creator revenue comes only from buys.
- Bond, Direct DEX and graduated Bond pools share the same `FeePolicy` and `UnifiedFeeHook` behavior.
- Uniswap v4 LP fee is overridden to zero so the protocol fee is never charged twice.
- LP principal and position custody are permanent; there is no principal withdrawal or NFT transfer path.
- Mutable parameters are bounded and controlled by a rotatable two-key, seven-day timelock.

On Base, half of trade platform revenue is routed automatically to native ETH BLUE staking and half to treasury. On Robinhood Chain, the staking half accumulates in a fixed bridge reserve for manual transfer to Base. Monad trades and launch fees use native MON; all platform MON revenue is routed to the BlueFun Safe and no cross-chain staking share is inferred.

## BLUE staking V2

BLUE staking exists only on Base. Native ETH rewards stream over seven days and active stake determines each account's share. Unstaking has a 30-day delay. Additional unstake requests aggregate and reset the countdown for the full pending balance; partial cancellation and partial withdrawal are supported.

## Base vNext mainnet

- Governance: `0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26`
- Fee policy: `0xe5c5585aB34F8e2ba55C30Ef5E6b0254d87a4941`
- Revenue router: `0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741`
- BLUE staking vault: `0x221a86096a334BcaFd5E561564dC8E6A48F19584`
- Unified fee hook: `0xF0b8dDe19510eE7D6D50Be289C4257EcD14C60CC`
- Bond market: `0x7d42dd1435e9567C1edFb513C45c8eA82fe03a38`
- Bond factory: `0x820344FB4C0a518d0CaEf5d3De96fF41CBe6b345`
- Bond LP locker: `0x484345C0Fc777d1945a84ADB6284D487daFB1de8`
- Graduation manager: `0x989bd9259408F73BB17099d37Df2CCdC57B271f3`
- Direct factory: `0x394c5D0244b49e1Eed533CD3505583e504589157`
- Direct LP locker: `0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7`
- Deployment block: `48678791`

All twelve deployment contracts, including the vault created by the router, are source-verified on BaseScan.

Robinhood vNext is deployed from block `10703400` and integrated into the active web/indexer catalogs. Controlled Bond and Direct live smoke launches passed on both networks. Historical deployments remain indexed against their original contracts while all new creation uses vNext.

- Governance: `0xa64ed8d4C4cAcFF075A4D1d50EE2F7795B4B0039`
- Fee policy: `0x4D0baaCfb8267C8f7ca39756Bb29f924dDd72a6a`
- Revenue router: `0xF42f51728ddffF6B4a556175DC5E5b68a1e5371B`
- Unified fee hook: `0x4C77A461669c0345960dD33d415747c8932F60cC`
- Bond factory: `0x32af28dfE63ff9e84399f0af51d5B84b4f3B3c62`
- Direct factory: `0x7De3165634679353a36886DCfe35e3521beee4A4`

## Monad mainnet

Monad vNext is deployed from block `89311403` (Direct factory block `89311452`) and uses native MON for gas, launches and trading. Bond and Direct live canaries passed, including exact sell-burn accounting and Safe revenue settlement.

- Governance: `0x448B856f684ca79CF60Ce24Dc29d1E3467f0551D`
- Fee policy: `0x72aA9A64E74566e5931883f5Bf1fD173bBD572e4`
- Revenue router: `0xD9f720a6A06BDe325a252C449E700253B30610ff`
- Unified fee hook: `0x65aAA8A131B4d4ed7f95C1F88740daeE4e1B20cc`
- Bond factory: `0x857430A20C3A5087e8f4f292B1573507567fa9cB`
- Direct factory: `0x773260193799321547BFeF0616cf57b3D7aa3412`
- Treasury Safe: `0x144A3f70C0bf33124852E3891011e033b909F46d`

## Applications

- `apps/web`: Next.js launch, market, docs, creator dashboard and staking interface.
- `apps/indexer`: deployment-scoped Node.js indexer for legacy and vNext launches, trades and graduations.
- `contracts`: Foundry contracts, tests and deployment scripts.

Both indexers may share one Supabase/Postgres database because rows and checkpoints are isolated by chain and deployment scope. Web and indexer must be deployed together when activating a new contract generation.

## Quality commands

```sh
forge test
forge build --sizes
npm run lint -w apps/web
npm run typecheck -w apps/web
npm run build:all
```

The vNext gate also includes Slither review, Base/Robinhood deployment simulations and a real Base Uniswap v4 fork test.

## Environment

Copy `apps/web/.env.example` and `apps/indexer/.env.example`. Never commit deployer keys, RPC secrets, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `PINATA_JWT` or other credentials. Public application variables contain contract addresses only.

The server-only `SITE_MAINTENANCE_MODE` switch controls the complete web interface. Set it to `true` in the web deployment environment and redeploy to show the maintenance screen on every page; set it back to `false` and redeploy to restore the application. It is intentionally not a public browser variable or unauthenticated HTTP toggle.

Production topology uses one web application plus independent Base, Robinhood and Monad indexer workers. Indexer workers expose `/health` on port `3000` and should not receive public domains.

[`docs/PROTOCOL.md`](docs/PROTOCOL.md) is the canonical protocol and operations reference. It contains current rules, every production address, legacy-token compatibility, indexer behavior, deployment evidence, environment guidance and the required change procedure.

[`docs/NFT_LAUNCHPAD.md`](docs/NFT_LAUNCHPAD.md) documents the verified Base mainnet creator-owned ERC-1155 launchpad, fees, allowlists, marketplace, OpenSea compatibility and security controls.

[`docs/MONAD_LAUNCHPAD.md`](docs/MONAD_LAUNCHPAD.md) records Monad-specific economics, governance, external contracts, deployment evidence and operating rules.
