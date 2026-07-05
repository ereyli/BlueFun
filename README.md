# BlueFun Launchpad

Professional, safety-first launchpad for Base-native B20 `ASSET` community tokens.

## What is included

- Foundry smart contracts for B20 launch creation, ETH bonding curve trading, policy validation, Uniswap v4 LP graduation, and adminless role cleanup.
- Mock B20 precompile contracts for local tests.
- Next.js app scaffold with launch, market, explore, and graduation pages.
- Node.js indexer scaffold for launch/trade/graduation events.

## Current network posture

B20 mainnet activation must be checked onchain before production deployment. The contracts default to activation-gated launch creation, and the frontend should treat Base Sepolia/local `base-anvil` as the initial supported environment.

## Commands

```sh
forge test
npm install
npm run lint --workspaces --if-present
```

## Environment

Copy `apps/web/.env.example` and `apps/indexer/.env.example` after deploying contracts to Base Sepolia. The frontend reads public contract addresses through `NEXT_PUBLIC_*`; the indexer reads the same deployed addresses plus `DATABASE_URL`.

For contract deployment, copy `.env.deploy.example`. Base Sepolia Uniswap v4 defaults are included:

- PositionManager: `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

## Local Postgres indexer

Start Postgres, then run the indexer:

```sh
docker compose up -d postgres
npm run dev -w apps/indexer
```

The indexer creates/updates the schema automatically, backfills `LaunchCreated`, `TokensBought`, `TokensSold`, and `Graduated` logs from `START_BLOCK` in `1900` block chunks, stores launch/trade/graduation state in Postgres, and keeps polling. This avoids Base Sepolia's `eth_getLogs` max block range errors in the web app.

When `POSTGRES_INDEXER_ENABLED=true` and `DATABASE_URL` are set in `apps/web/.env.local`, the web app reads launches from Postgres and does not scan historical logs directly from the server render path. For Supabase, the web app should use `SUPABASE_ANON_KEY` with the public read policies in `apps/indexer/schema.sql`; keep `SUPABASE_SERVICE_ROLE_KEY` only in the indexer worker.

```sh
docker compose up -d postgres
npm run dev -w apps/indexer
npm run dev -w apps/web
```

For a quick frontend-only fallback without Postgres, keep `POSTGRES_INDEXER_ENABLED=false`; the app will read `launchCount` and per-launch state directly from `BondingCurveMarket` without scanning historical logs.

## Production notes

- Deploy with `UniswapV4LiquidityLocker` for public testnet/mainnet flows.
- `ProtocolLiquidityLocker` is an escrow-style development locker and reports `isDexBacked() == false`; `GraduationManager` will revert against it so production cannot falsely claim DEX LP lock.
- Keep `activationGateEnabled` on for production.
- Do not enable Base mainnet launch creation until `ActivationRegistry.isActivated(keccak256("base.b20_asset"))` returns true.
- Treat npm audit output seriously before production; high severity advisories are blocked by package overrides, while remaining moderate wallet SDK advisories should be tracked during wallet-stack upgrades.
- Rotate all deployer keys, Supabase service role keys, anon keys, and database passwords that were shared during setup before any public deployment.

## Base Sepolia deployment

- `BondingCurveMarket`: `0x6e77d6418b9065cc947dba95bd1cbba3ca881318`
- `UniswapV4LiquidityLocker`: `0xeb3e83ab91bd44959ace28b5f1cccb79b4b4092d`
- `GraduationManager`: `0x504e4237d93310ae29980208e95d928666528b84`
- `LaunchFactory`: `0x76ab1405fbc28e6df6b02dc0c38b1486842ff294`
- Deployment block: `43613084`
- Graduation target: fixed `5 ETH`
