# BlueFun Launchpad

Professional multichain launchpad for Base-native B20 `ASSET` tokens and fixed-supply ERC-20 tokens on Robinhood Chain.

## What is included

- Foundry smart contracts for B20 launch creation, ETH bonding curve trading, policy validation, Uniswap v4 LP graduation, and adminless role cleanup.
- Mock B20 precompile contracts for local tests.
- Next.js application with launch, market, explore, signed community chat, cursor pagination, and responsive error/legal surfaces.
- Production Node.js indexer for launch, curve trade, Uniswap v4 trade, graduation, metadata, health, and aggregate metrics.

## Network model

- Base (`8453`) launches use the Base-only B20 token standard.
- Robinhood Chain (`4663`) launches use fixed-supply ERC-20 tokens.
- Each network has an independent indexer process. Both processes may share the same Supabase/Postgres database because every row and checkpoint is isolated by deployment scope.
- Graduation uses the network's Uniswap v4 deployment and custody-locks the LP position permanently.

## Commands

```sh
forge test
npm install
npm run lint -w apps/web
npm run typecheck -w apps/web
npm run build:all
```

## Environment

Copy `apps/web/.env.example` and `apps/indexer/.env.example`. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `PINATA_JWT`, or `RATE_LIMIT_SALT` through a `NEXT_PUBLIC_` variable.

For contract deployment, copy `.env.deploy.example`. Base Sepolia Uniswap v4 defaults are included:

- PositionManager: `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

## Local Postgres indexer

Start Postgres, then run the indexer:

```sh
docker compose up -d postgres
npm run dev -w apps/indexer
```

The indexer applies `apps/indexer/schema.sql`, backfills launch, curve trade, graduation, and Uniswap v4 swap logs in bounded chunks, then polls continuously. It exposes `/health` on port `3000` and backs off on RPC rate limiting.

When `POSTGRES_INDEXER_ENABLED=true`, the web app reads indexed launches and aggregates instead of scanning historical logs during rendering. Public launch/trade reads can use Supabase anon credentials. Shared rate limiting and persistent signed chat additionally require either the server-only service role key or `DATABASE_URL`.

```sh
docker compose up -d postgres
npm run dev -w apps/indexer
npm run dev -w apps/web
```

For a quick frontend-only fallback without Postgres, keep `POSTGRES_INDEXER_ENABLED=false`; the app will read `launchCount` and per-launch state directly from `BondingCurveMarket` without scanning historical logs.

## Coolify production topology

Deploy three applications from the same `main` branch:

1. `bluefun-web`: the existing web Dockerfile/build configuration and the web environment variables.
2. `bluefun-indexer-base`: `Dockerfile.indexer`, `CHAIN_ID=8453`, Base RPC values, and the shared database credentials.
3. `bluefun-indexer-robinhood`: `Dockerfile.indexer`, `CHAIN_ID=4663`, `RPC_URL=https://rpc.mainnet.chain.robinhood.com`, optional `ROBINHOOD_RPC_FALLBACK_URLS`, and the same database credentials.

Do not assign public domains to the indexers. Configure Coolify's container health check against `/health` on port `3000`. Auto-deploying the web application is safe after the quality workflow succeeds; the two indexers should also redeploy because schema and worker code live in this repository.

## Production notes

- Deploy with `UniswapV4LiquidityLocker` for public testnet/mainnet flows.
- `ProtocolLiquidityLocker` is an escrow-style development locker and reports `isDexBacked() == false`; `GraduationManager` will revert against it so production cannot falsely claim DEX LP lock.
- Keep `activationGateEnabled` on for production.
- Do not enable Base mainnet launch creation until `ActivationRegistry.isActivated(keccak256("base.b20_asset"))` returns true.
- Treat dependency audit output seriously. Remaining moderate wallet/build-tool advisories require coordinated major-version upgrades and should stay tracked until the full wallet flow passes regression testing.
- Rotate all deployer keys, Supabase service role keys, anon keys, and database passwords that were shared during setup before any public deployment.

## Base Sepolia deployment

- `BondingCurveMarket`: `0x63c1E321822529D86d10f02bc910636Bb85F0831`
- `UniswapV4LiquidityLocker`: `0xc395473A08912A4CAfC6Ab3CCd65Eb5229B3fdE8`
- `GraduationManager`: `0x79bCAbD89870d578BdbD00D87E3532d74d0093AD`
- `LaunchFactory`: `0x6fe3582939f5a25fF5AFAbC59562eA560936AB35`
- Deployment block: `43826794`
- Indexer scope: `84532:0x6fe3582939f5a25ff5afabc59562ea560936ab35:0x63c1e321822529d86d10f02bc910636bb85f0831:43826794`
- Graduation target: fixed `5 ETH` gross raised; curve fees are deducted before DEX liquidity is locked.

## Robinhood Chain mainnet deployment

- Network: Robinhood Chain (`4663`), standard fixed-supply ERC-20 launches.
- `BondingCurveMarket`: `0xab7597fecaf3357101a3a4331f512031ef3238f0`
- `UniswapV4LiquidityLocker`: `0x2d1e48fb40f00ed48f2e16df4a7a587fd063d177`
- `Erc20GraduationManager`: `0xf6545a701a8cbe80d573043e8ffb8210de913d28`
- `Erc20LaunchFactory`: `0x6a05304638bed7c96b78f420c612e84111fad4d1`
- Deployment block: `5576234`
- Graduation uses the official Robinhood Chain Uniswap v4 deployment and permanently custody-locks the LP position.
