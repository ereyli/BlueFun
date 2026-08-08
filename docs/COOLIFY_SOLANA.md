# Coolify Solana rollout

Solana uses the existing web application and shared database, plus one separate
indexer process. Do not point the EVM indexer at a Solana RPC.

## Web

Add these as both build-time and runtime variables, then redeploy web after the
program and config PDA are live:

```dotenv
NEXT_PUBLIC_SOLANA_RPC_URL=https://your-private-solana-mainnet-rpc
NEXT_PUBLIC_SOLANA_PROGRAM_ID=CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5
POSTGRES_INDEXER_ENABLED=true
```

Keep the existing database, Pinata, WalletConnect and EVM variables unchanged.

## Solana indexer

Create one additional Coolify application from the same repository and use the
existing indexer Dockerfile/build configuration. Set its start command to:

```bash
npm run start:solana -w apps/indexer
```

Environment:

```dotenv
SOLANA_RPC_URL=https://your-private-solana-mainnet-rpc
SOLANA_PROGRAM_ID=CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5
POLL_MS=5000
HEALTH_PORT=3101
DATABASE_URL=postgresql://...
```

Alternatively use the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as the
other indexers. Give this service its own internal/generated domain only if you
want to inspect `/health`; the web app does not call the indexer directly.
