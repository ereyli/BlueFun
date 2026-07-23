# Coolify: Stable Indexer Worker

Deploy Stable as a fourth independent worker from the same repository and
`Dockerfile.indexer`. Do not merge chain polling into the web service.

Use the same Supabase project as the Base, Robinhood and Monad workers. Rows,
trades and checkpoints are isolated by chain ID and deployment scope; no new
SQL migration is required for Stable.

Required environment:

```text
CHAIN_ID=988
RPC_URL=https://rpc.stable.xyz
STABLE_RPC_FALLBACK_URLS=
DIRECT_LAUNCH_FACTORY=0xc2c29581179111aa94ba12affd3486879e42090c
DIRECT_LIQUIDITY_LOCKER=0x8d51017c392552333a679ccb60b5df84314c64cd
DIRECT_DEPLOYMENT_BLOCK=32827109
SUPABASE_URL=<same project>
SUPABASE_SERVICE_ROLE_KEY=<same service role>
CONFIRMATIONS=2
POLL_MS=1200
LOG_CHUNK_SIZE=450
HEALTH_PORT=3000
REQUIRE_SCHEMA_VERSION=true
```

Use no public domain. Configure Coolify's health check as `GET /health` on
port `3000`. After deployment, confirm the response reports chain ID `988`,
the expected Direct scope, schema readiness, a recent successful poll and low
confirmed-head lag.

The web deployment additionally needs:

```text
NEXT_PUBLIC_STABLE_RPC_URL=https://rpc.stable.xyz
NEXT_PUBLIC_STABLE_DIRECT_LAUNCH_FACTORY=0xc2c29581179111aa94ba12affd3486879e42090c
NEXT_PUBLIC_STABLE_DIRECT_LIQUIDITY_LOCKER=0x8d51017c392552333a679ccb60b5df84314c64cd
NEXT_PUBLIC_STABLE_DIRECT_DEPLOYMENT_BLOCK=32827109
```

Redeploy the Stable indexer first, wait until its deployment block is indexed,
then redeploy the web application.
