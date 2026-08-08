# Coolify Solana rollout

Solana uses the existing web application and shared database, plus one separate
indexer process. Do not point the EVM indexer at a Solana RPC.

## Web

Add the program id as a build-time and runtime variable. Add the RPC URL as a
runtime-only, server-side variable; BlueFun proxies browser Solana calls through
its own same-origin endpoint so private provider keys are not exposed:

```dotenv
SOLANA_RPC_URL=https://your-private-solana-mainnet-rpc
NEXT_PUBLIC_SOLANA_PROGRAM_ID=CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5
POSTGRES_INDEXER_ENABLED=true
```

Keep the existing database, Pinata, WalletConnect and EVM variables unchanged.

## Solana indexer

Create one additional Coolify application from the same repository and use the
existing indexer Dockerfile/build configuration. Leave Coolify's start-command
override empty and select the Solana process with `INDEXER_MODE=solana`.

Environment:

```dotenv
INDEXER_MODE=solana
SOLANA_RPC_URL=https://your-private-solana-mainnet-rpc
SOLANA_PROGRAM_ID=CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5
POLL_MS=5000
HEALTH_PORT=3000
DATABASE_URL=postgresql://...
```

Alternatively use the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as the
other indexers. Give this service its own internal/generated domain only if you
want to inspect `/health`; the web app does not call the indexer directly.
