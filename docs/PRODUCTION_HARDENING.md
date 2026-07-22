# Production hardening

## Required database migration

Apply `apps/indexer/migrations/20260722_production_hardening.sql` once in the
Supabase SQL editor before redeploying the web application and indexers. It:

- records trades and launch volume in one atomic database function;
- persists the latest market cap from both buys and sells;
- enables Realtime updates for NFT listings;
- records the expected indexer schema version.

After the migration is applied, set `REQUIRE_SCHEMA_VERSION=true` on every
indexer service. A worker will then refuse to start against an outdated schema
instead of silently producing partial data.

## Deployment model

Keep one indexer service per chain (`CHAIN_ID=8453`, `4663`, or `143`). Do not
scale a chain indexer above one replica until distributed leader election is
implemented. Web replicas can scale independently.

The `/health` response reports chain head, confirmed head, indexed lag, poll
duration, consecutive failures, and the database schema version. Configure
Coolify alerts for a non-200 health response and external monitoring for:

- `indexedLagBlocks` remaining above 20 for five minutes;
- `consecutiveFailures` above 3;
- `lastSuccessfulPollAt` older than three minutes;
- `schema.ready` being false.

Each successful poll also stores a confirmed block hash. If that checkpoint is
no longer canonical, the worker stops advancing and exposes `REORG_DETECTED` in
`lastError`; this prevents a deep reorg from being silently accepted. Reconcile
the affected chain data before resetting its canonical checkpoint.

## Supabase operations

Enable point-in-time recovery where available and perform a restore test before
holding material TVL. Database migrations should be applied before application
deployments and committed in filename order.
