# Stock-pair Direct launches

BlueFun supports meme/Stock Token Uniswap v4 markets on Base and Robinhood Chain through a separate, fail-closed contract suite. The ordinary native-token Direct and Bond routes are unchanged. In Robinhood-facing product copy, use the official term “Stock Token”; do not describe Robinhood Stock Tokens as tokenized stocks or tokenized equities.

## Asset sources

- Base uses the stock B20 addresses and Chainlink feeds published in the official Base B20 stock catalog. The single maintained snapshot is `config/stock-assets.base.json`; adding a newly published Base asset there updates both the web catalog and registry planner. Assets are identified by contract address, never by ticker text.
- Robinhood Chain reads its active asset set from `https://api.robinhood.com/rhj/assets`. This currently returns 194 active 18-decimal assets and automatically includes later additions.
- Robinhood Chainlink feeds come from the Chainlink Reference Data Directory. Official Robinhood assets without a published feed use a two-minute opening-price attestation signed by BlueFun's isolated price signer. The attestation is bound to chain ID, registry, token address, price and expiry and is only used to set the launch's opening price.
- Discovery does not authorize an asset. `StockQuoteRegistry` is the onchain source of truth and is administered through the existing governance timelock/Safe.

## Safety properties

- Fixed 1B launch supply and no creator allocation.
- The complete launch supply is placed as one-sided liquidity in the stock-quoted pool.
- The position remains in `StockLiquidityLocker`; it has no withdrawal or NFT-transfer path.
- Launch prices fail closed on missing, stale, paused, expired or incorrectly signed data.
- Initial creator purchase is optional and capped at 5% of supply.
- Shared fee policy: buy charges 0.7% platform plus 0.3% creator in the stock quote; sell charges 0.7% platform in stock quote and burns 0.3% of meme-token input.

## Deployment

Do not publish the web variables until deployment, registry population, timelock acceptance and fork smoke tests have completed.

Required deploy-script variables:

```text
DEPLOYER_PRIVATE_KEY=
STOCK_GOVERNANCE=
STOCK_PRICE_SIGNER=
STOCK_PLATFORM_FEE_RECIPIENT=
STOCK_FEE_POLICY=
STOCK_REVENUE_ROUTER=
```

Deploy with `contracts/script/DeployStockDirectMainnet.s.sol`, then generate registry transactions while the deployer remains admin:

```bash
npm run stocks:plan -- --chain=8453 --registry=0x...
npm run stocks:plan -- --chain=4663 --registry=0x...
```

The command is intentionally dry-run only. It emits Safe/timelock-compatible `to` and `data` payloads in chunks of at most 25 assets. After executing every payload, governance must call `acceptAdmin()` on the registry.

Web variables per network:

```text
NEXT_PUBLIC_BASE_STOCK_DIRECT_LAUNCH_FACTORY=
NEXT_PUBLIC_BASE_STOCK_LIQUIDITY_LOCKER=
NEXT_PUBLIC_BASE_STOCK_QUOTE_REGISTRY=
NEXT_PUBLIC_BASE_STOCK_FEE_HOOK=
NEXT_PUBLIC_BASE_STOCK_DEPLOYMENT_BLOCK=

NEXT_PUBLIC_ROBINHOOD_STOCK_DIRECT_LAUNCH_FACTORY=
NEXT_PUBLIC_ROBINHOOD_STOCK_LIQUIDITY_LOCKER=
NEXT_PUBLIC_ROBINHOOD_STOCK_QUOTE_REGISTRY=
NEXT_PUBLIC_ROBINHOOD_STOCK_FEE_HOOK=
NEXT_PUBLIC_ROBINHOOD_STOCK_DEPLOYMENT_BLOCK=

# Server-only. Never use NEXT_PUBLIC_ for this value.
STOCK_PRICE_SIGNER_PRIVATE_KEY=
```

The server key must correspond to `STOCK_PRICE_SIGNER`. Keep it isolated from deployer and treasury keys and rotate it through `StockQuoteRegistry.setPriceSigner` if exposure is suspected.

Base mainnet defaults (already deployed):

```dotenv
NEXT_PUBLIC_BASE_STOCK_DIRECT_LAUNCH_FACTORY=0x8b083cc5109dbe56b5e8113837dd67ef1954ea00
NEXT_PUBLIC_BASE_STOCK_LIQUIDITY_LOCKER=0x23f98c37948d85b79a26231369c202f44b23f8a5
NEXT_PUBLIC_BASE_STOCK_QUOTE_REGISTRY=0x15b0622a01ed553f4e499d32db7d6f8a9f6f4eb5
NEXT_PUBLIC_BASE_STOCK_FEE_HOOK=0xee914f563a514bc4be50214a8d403981565aa0cc
NEXT_PUBLIC_BASE_STOCK_DEPLOYMENT_BLOCK=50957728

STOCK_DIRECT_LAUNCH_FACTORY=0x8b083cc5109dbe56b5e8113837dd67ef1954ea00
STOCK_LIQUIDITY_LOCKER=0x23f98c37948d85b79a26231369c202f44b23f8a5
STOCK_DEPLOYMENT_BLOCK=50957728
```

Before restarting the EVM indexer, apply `apps/indexer/migrations/20260906_stock_pair_launches.sql` to Supabase. Base uses Chainlink-backed registry prices for its currently enabled Stock Tokens, so the server signing key is not used for those entries.

### Base mainnet deployment record

- Deployment block: `50957728`
- Registry deployment: `0xea2566971d9eb2400a26bb786408bd311a8dbb7269e00c8a0d7a7baa70054e3c`
- Fee hook deployment: `0x3da9654a2bd1b07fcc45d3881f5f973d46a5443d6e49a16abaeb063563ef94f3`
- Locker deployment: `0xfa4629745be5d2d68b1bacfda2cbd3bc20f676ef56ba858d325fd67d4273dd4c`
- Factory deployment: `0x91f19fe159ddef6a170bf5fb0c4029a9183ba0f8184f7d4d723a20330833145a`
- 13-asset registry configuration: `0x1144d365d04a0f78e1bef2793f4893764675554e03323143da98ab9be224206c`

The factory is owned by the Base governance timelock. Registry administration is still held by the deployer with the governance timelock recorded as `pendingAdmin`; the timelock must call `acceptAdmin()` to finish the two-step handoff.

## Legal/product gate

The launch UI requires an eligibility confirmation and explains that Stock Tokens can be jurisdiction-restricted and may not convey direct ownership or shareholder rights. This is a product safeguard, not a substitute for jurisdiction-specific legal review.
