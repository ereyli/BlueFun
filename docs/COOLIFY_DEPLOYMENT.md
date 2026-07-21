# Coolify NFT V4 rollout

BlueFun already runs as three separate Coolify applications. Do not create a new
Compose resource for the NFT launchpad rollout.

- `web`: update and redeploy
- `base-indexer`: update NFT variables and redeploy first
- `robinhood-indexer`: no NFT-specific change

The existing Supabase project remains the shared database.

## 1. Update the Base indexer

Keep the existing RPC, Supabase and general token-launch variables. Replace or
add only these NFT variables:

```dotenv
NFT_COLLECTION_FACTORY=0xd8cf5150a4d789cab4b03855d3ff536c78fd4b33
NFT_DROP_CONTROLLER=0xf7fc2f208b936a5858f9ae7f7750147c8284a2c6
NFT_MARKETPLACE=0x5be0b302e32031378fdbdea3e5bb3d487e345761
NFT_DEPLOYMENT_BLOCK=48886053
NFT_PFP_FACTORY=0x022742905a07f4534f9794ceb8c42be23a1c6815
NFT_PFP_MARKETPLACE=0x8a777d7d590b658ab07b0aee90ccc51b79c2981d
NFT_PFP_DEPLOYMENT_BLOCK=48886056
NFT_OFFERS=0xdfb2ae739446fc8ffc57793005e687ce695dda64
NFT_OFFERS_DEPLOYMENT_BLOCK=48886061
```

Deploy the Base indexer and wait until `/health` is healthy and the logs show a
recent indexed block. Its Dockerfile is `Dockerfile.indexer` and internal health
port is the service's existing `HEALTH_PORT`.

## 2. Update the web application

Keep the existing Supabase, Pinata, WalletConnect, RPC and site variables.
Replace or add these variables:

```dotenv
NEXT_PUBLIC_NFT_FEE_POLICY=0xc982023f393626309e13b7b75d988c273a9f7786
NEXT_PUBLIC_NFT_DROP_CONTROLLER=0xf7fc2f208b936a5858f9ae7f7750147c8284a2c6
NEXT_PUBLIC_NFT_COLLECTION_FACTORY=0xd8cf5150a4d789cab4b03855d3ff536c78fd4b33
NEXT_PUBLIC_NFT_MARKETPLACE=0x5be0b302e32031378fdbdea3e5bb3d487e345761
NEXT_PUBLIC_NFT_PFP_FACTORY=0x022742905a07f4534f9794ceb8c42be23a1c6815
NEXT_PUBLIC_NFT_PFP_MARKETPLACE=0x8a777d7d590b658ab07b0aee90ccc51b79c2981d
NEXT_PUBLIC_NFT_PFP_DEPLOYMENT_BLOCK=48886056
NEXT_PUBLIC_NFT_DEPLOYMENT_BLOCK=48886053
NEXT_PUBLIC_NFT_OFFERS=0xdfb2ae739446fc8ffc57793005e687ce695dda64
NEXT_PUBLIC_NFT_OFFERS_DEPLOYMENT_BLOCK=48886061
NEXT_PUBLIC_NFT_PROTOCOL_VERSION=v4
NEXT_PUBLIC_BASE_WETH=0x4200000000000000000000000000000000000006
POSTGRES_INDEXER_ENABLED=true
ONCHAIN_FALLBACK_ENABLED=false
```

All `NEXT_PUBLIC_*` entries must be available during the Next.js build. In
Coolify, mark them as build variables as well as runtime variables. Redeploy the
web application only after the Base indexer is healthy.

The repository includes `Dockerfile.web` and `/api/health`; an already-working
Nixpacks configuration does not have to switch build packs for this rollout.

## 3. Release checks

1. `https://funblue.xyz/api/health` returns HTTP 200 and protocol `v4`.
2. `/nft` lists only V4-created collections.
3. Collection pages show minted images, floor, listings and offers.
4. Run a low-value mint, list, buy, offer, accept and cancel smoke test.
5. Confirm seller proceeds and protocol fee transfers on BaseScan.

Update the Coolify variables before pushing the production branch when automatic
deployments are enabled. This prevents a build from embedding stale V3 addresses.
