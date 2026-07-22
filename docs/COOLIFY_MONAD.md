# Monad production deployment on Coolify

Monad uses a separate indexer process but the same Supabase project and schema as
the Base and Robinhood indexers. No additional SQL migration is required.

## Web application

Add the variables below to the existing web application. Because Next.js embeds
`NEXT_PUBLIC_*` values in the browser bundle, enable both **Build Variable** and
**Runtime Variable**, then redeploy the application.

```dotenv
NEXT_PUBLIC_MONAD_RPC_URL=https://rpc.monad.xyz
NEXT_PUBLIC_MONAD_RPC_FALLBACK_URLS=https://rpc1.monad.xyz
NEXT_PUBLIC_MONAD_LAUNCH_FACTORY=0x857430A20C3A5087e8f4f292B1573507567fa9cB
NEXT_PUBLIC_MONAD_BONDING_CURVE_MARKET=0xB2a827Da4Bd935902baE6B5640d6384C2ef53821
NEXT_PUBLIC_MONAD_GRADUATION_MANAGER=0xac03C2d754654015Cc6839625FAa883BB92959f2
NEXT_PUBLIC_MONAD_LIQUIDITY_LOCKER=0x0488E96d545A977672aA75EF374a385d054AF2cb
NEXT_PUBLIC_MONAD_DIRECT_LAUNCH_FACTORY=0x773260193799321547BFeF0616cf57b3D7aa3412
NEXT_PUBLIC_MONAD_DIRECT_LIQUIDITY_LOCKER=0xb5fAb655a3b7187175Ac339075DA11542e58d81d
NEXT_PUBLIC_MONAD_FEE_HOOK=0x65aAA8A131B4d4ed7f95C1F88740daeE4e1B20cc
NEXT_PUBLIC_MONAD_DEPLOYMENT_BLOCK=89311403
NEXT_PUBLIC_MONAD_DIRECT_DEPLOYMENT_BLOCK=89311452
```

Keep the existing Supabase, WalletConnect, Pinata and Base/Robinhood variables.

## Separate Monad indexer application

Create a new application from the same repository and branch. Use:

- Build pack: `Dockerfile`
- Base directory: `/`
- Dockerfile: `/Dockerfile.indexer`
- Exposed/internal port: `3000`
- Public domain: not required

Add these runtime variables. Copy the two Supabase secrets from the existing
indexer application without exposing them in source control.

```dotenv
CHAIN_ID=143
RPC_URL=https://rpc.monad.xyz
RPC_FALLBACK_URLS=https://rpc1.monad.xyz
SUPABASE_URL=<same Supabase URL as the existing indexers>
SUPABASE_SERVICE_ROLE_KEY=<same service-role key as the existing indexers>
HEALTH_PORT=3000
LOG_CHUNK_SIZE=1900
POLL_MS=1200
CONFIRMATIONS=2
BOND_LAUNCH_FACTORY=0x857430A20C3A5087e8f4f292B1573507567fa9cB
BONDING_CURVE_MARKET=0xB2a827Da4Bd935902baE6B5640d6384C2ef53821
GRADUATION_MANAGER=0xac03C2d754654015Cc6839625FAa883BB92959f2
BOND_LIQUIDITY_LOCKER=0x0488E96d545A977672aA75EF374a385d054AF2cb
FEE_HOOK=0x65aAA8A131B4d4ed7f95C1F88740daeE4e1B20cc
BOND_DEPLOYMENT_BLOCK=89311403
DIRECT_LAUNCH_FACTORY=0x773260193799321547BFeF0616cf57b3D7aa3412
DIRECT_LIQUIDITY_LOCKER=0xb5fAb655a3b7187175Ac339075DA11542e58d81d
DIRECT_DEPLOYMENT_BLOCK=89311452
```

Do not add `DATABASE_URL` when using the Supabase REST writer. Do not copy Base,
Robinhood or `NFT_*` variables into the Monad resource. In particular, an NFT
factory variable would make this process scan an unrelated contract on Monad.

After deployment, Coolify should report the Docker health check as healthy. Its
internal `GET /health` response should show chain ID `143`, status `ok`, and both
bond/direct cursors advancing beyond their deployment blocks.
