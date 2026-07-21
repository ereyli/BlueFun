# Coolify production deployment

BlueFun runs as one Coolify Docker Compose resource with three services:

- `web`: public Next.js application on port 3000
- `indexer-base`: private Base and NFT indexer with `/health` on port 3000
- `indexer-robinhood`: private Robinhood Chain indexer with `/health` on port 3000

The current Supabase project remains the shared database. Do not add a Coolify
Postgres service unless the application is deliberately migrated away from
Supabase.

## Coolify resource

1. Push the intended production commit to the GitHub repository.
2. In Coolify choose **New Resource > Private Repository (with GitHub App)**.
3. Select the repository and the production branch.
4. Choose **Docker Compose** as the build pack.
5. Set **Base Directory** to `/` and **Docker Compose Location** to
   `/coolify-compose.yml`.
6. Assign `https://funblue.xyz` (and optionally `https://www.funblue.xyz`) only
   to the `web` service and its internal port `3000`.
7. Do not expose either indexer with a public domain or host port.

## Required Coolify variables

Set these before the first build. Mark the three public variables as both build
and runtime variables when using separate Dockerfile resources; the compose file
already forwards them as Docker build arguments.

```dotenv
NEXT_PUBLIC_SITE_URL=https://funblue.xyz
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RATE_LIMIT_SALT=
PINATA_JWT=
```

Recommended production overrides:

```dotenv
BASE_RPC_URL=
BASE_RPC_FALLBACK_URLS=
NEXT_PUBLIC_BASE_RPC_URL=
NEXT_PUBLIC_BASE_RPC_FALLBACK_URLS=
NEXT_PUBLIC_TOKEN_IMAGE_CDN_URL=
TOKEN_IMAGE_CDN_URL=
```

Use a dedicated paid Base RPC endpoint for `BASE_RPC_URL`. Public RPC endpoints
remain fallbacks. Store `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, and
`PINATA_JWT` as secrets and never expose them with a `NEXT_PUBLIC_` prefix.

The canonical NFT V4 addresses and deployment blocks are pinned as defaults in
`coolify-compose.yml`. Coolify overrides should only be added when a newer audited
deployment intentionally replaces V4.

## First release order

1. Deploy all services from the compose resource.
2. Wait for both indexers to become healthy. The first backfill can take longer
   than normal polling.
3. Confirm `https://funblue.xyz/api/health` returns HTTP 200 and protocol `v4`.
4. Check the Base indexer logs for the V4 NFT scope and a recent indexed block.
5. Smoke-test wallet connect, one collection page, NFT images, listing, offer and
   mint reads before changing DNS for all users.

For safer releases, deploy first on `staging.funblue.xyz`, run the smoke tests,
then attach the production domain to the same healthy revision.
