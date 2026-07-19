import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

let pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
let supabase: SupabaseClient | undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function ensureSchema() {
  if (hasSupabaseConfig()) return;
  if (!pool) throw new Error("Set DATABASE_URL or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");

  const schemaPath = path.resolve(__dirname, "../schema.sql");
  await pool.query(await fs.readFile(schemaPath, "utf8"));
}

export async function upsertLaunch(scope: string, input: {
  id: bigint;
  token: string;
  creator: string;
  name: string;
  symbol: string;
  contractURI: string;
  imageUri?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  launchMode?: "bond" | "direct";
  poolFee?: number;
  tickSpacing?: number;
  liquidityLocker?: string;
  txHash: string;
  blockNumber?: bigint;
}) {
  if (hasSupabaseConfig()) {
    await runSupabase(
      getSupabase()
        .from("launches")
        .upsert(
          {
            scope,
            id: input.id.toString(),
            token: input.token,
            creator: input.creator,
            name: input.name,
            symbol: input.symbol,
            contract_uri: input.contractURI,
            image_url: input.imageUri || null,
            description: input.description || null,
            website_url: input.website || null,
            twitter_url: input.twitter || null,
            telegram_url: input.telegram || null,
            discord_url: input.discord || null,
            launch_mode: input.launchMode || "bond",
            pool_fee: input.poolFee ?? 3000,
            tick_spacing: input.tickSpacing ?? 60,
            liquidity_locker: input.liquidityLocker || null,
            created_tx: input.txHash,
            created_block: input.blockNumber?.toString()
          },
          { onConflict: "scope,id" }
        )
    );
    return;
  }

  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into launches (
       scope, id, token, creator, name, symbol, contract_uri, image_url, description,
       website_url, twitter_url, telegram_url, discord_url, launch_mode, pool_fee, tick_spacing,
       liquidity_locker, created_tx, created_block
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     on conflict (scope, id) do update set
       token = excluded.token,
       creator = excluded.creator,
       name = excluded.name,
       symbol = excluded.symbol,
       contract_uri = excluded.contract_uri,
       image_url = excluded.image_url,
       description = excluded.description,
       website_url = excluded.website_url,
       twitter_url = excluded.twitter_url,
       telegram_url = excluded.telegram_url,
       discord_url = excluded.discord_url,
       launch_mode = excluded.launch_mode,
       pool_fee = excluded.pool_fee,
       tick_spacing = excluded.tick_spacing,
       liquidity_locker = excluded.liquidity_locker,
       created_tx = excluded.created_tx,
       created_block = coalesce(excluded.created_block, launches.created_block)`,
    [
      scope,
      input.id.toString(),
      input.token,
      input.creator,
      input.name,
      input.symbol,
      input.contractURI,
      input.imageUri || null,
      input.description || null,
      input.website || null,
      input.twitter || null,
      input.telegram || null,
      input.discord || null,
      input.launchMode || "bond",
      input.poolFee ?? 3000,
      input.tickSpacing ?? 60,
      input.liquidityLocker || null,
      input.txHash,
      input.blockNumber?.toString()
    ]
  );
}

export async function updateLaunchState(scope: string, input: {
  id: bigint;
  status: "live" | "ready" | "graduated";
  raisedEth: bigint;
  graduationTargetEth: bigint;
  progress: number;
  creatorAllocation: bigint;
  tokenCreatedAt: bigint;
}) {
  if (hasSupabaseConfig()) {
    await runSupabase(
      getSupabase()
        .from("launches")
        .update({
          status: input.status,
          raised_eth: input.raisedEth.toString(),
          graduation_target_eth: input.graduationTargetEth.toString(),
          progress: input.progress,
          creator_allocation: input.creatorAllocation.toString(),
          token_created_at: input.tokenCreatedAt.toString()
        })
        .eq("id", input.id.toString())
        .eq("scope", scope)
    );
    return;
  }

  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `update launches
     set status = $3,
         raised_eth = $4,
         graduation_target_eth = $5,
         progress = $6,
         creator_allocation = $7,
         token_created_at = $8
     where scope = $1 and id = $2`,
    [
      scope,
      input.id.toString(),
      input.status,
      input.raisedEth.toString(),
      input.graduationTargetEth.toString(),
      input.progress,
      input.creatorAllocation.toString(),
      input.tokenCreatedAt.toString()
    ]
  );
}

export async function insertTrade(scope: string, input: {
  launchId: bigint;
  trader: string;
  side: "buy" | "sell";
  source?: "curve" | "uniswap_v4";
  ethAmount: bigint;
  tokenAmount: bigint;
  marketCapEth?: bigint;
  txHash: string;
  blockNumber?: bigint;
}) {
  if (hasSupabaseConfig()) {
    const existing = await getSupabase()
      .from("trades")
      .update({
        trader: input.trader,
        side: input.side,
        source: input.source || "curve",
        eth_amount: input.ethAmount.toString(),
        token_amount: input.tokenAmount.toString(),
        market_cap_eth: input.marketCapEth?.toString() ?? null,
        block_number: input.blockNumber?.toString()
      })
      .eq("scope", scope)
      .eq("launch_id", input.launchId.toString())
      .eq("tx_hash", input.txHash)
      .eq("side", input.side)
      .select("id");
    if (existing.error) throw existing.error;
    if ((existing.data ?? []).length > 0) {
      await refreshLaunchVolume(scope, input.launchId);
      return;
    }

    const inserted = await getSupabase()
        .from("trades")
        .upsert(
          {
            scope,
            launch_id: input.launchId.toString(),
            trader: input.trader,
            side: input.side,
            source: input.source || "curve",
            eth_amount: input.ethAmount.toString(),
            token_amount: input.tokenAmount.toString(),
            market_cap_eth: input.marketCapEth?.toString() ?? null,
            tx_hash: input.txHash,
            block_number: input.blockNumber?.toString()
          },
          { onConflict: "scope,tx_hash,side,launch_id", ignoreDuplicates: true }
        )
        .select("id");
    if (inserted.error) throw inserted.error;
    if ((inserted.data ?? []).length > 0) await incrementLaunchVolume(scope, input.launchId, input.ethAmount);
    return;
  }

  if (!pool) throw new Error("Database client is not configured");
  const existing = await pool.query(
    `update trades
     set trader = $4,
         side = $5,
         source = $6,
         eth_amount = $7,
         token_amount = $8,
         block_number = $9,
         market_cap_eth = $10
     where scope = $1 and launch_id = $2 and tx_hash = $3 and side = $5`,
    [
      scope,
      input.launchId.toString(),
      input.txHash,
      input.trader,
      input.side,
      input.source || "curve",
      input.ethAmount.toString(),
      input.tokenAmount.toString(),
      input.blockNumber?.toString(),
      input.marketCapEth?.toString() ?? null
    ]
  );
  if ((existing.rowCount ?? 0) > 0) {
    await refreshLaunchVolume(scope, input.launchId);
    return;
  }

  const inserted = await pool.query(
    `insert into trades (scope, launch_id, trader, side, source, eth_amount, token_amount, market_cap_eth, tx_hash, block_number)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (scope, tx_hash, side, launch_id) do nothing
     returning id`,
    [
      scope,
      input.launchId.toString(),
      input.trader,
      input.side,
      input.source || "curve",
      input.ethAmount.toString(),
      input.tokenAmount.toString(),
      input.marketCapEth?.toString() ?? null,
      input.txHash,
      input.blockNumber?.toString()
    ]
  );
  if ((inserted.rowCount ?? 0) > 0) await incrementLaunchVolume(scope, input.launchId, input.ethAmount);
}

async function incrementLaunchVolume(scope: string, launchId: bigint, amount: bigint) {
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().rpc("increment_launch_volume", {
      p_scope: scope,
      p_launch_id: launchId.toString(),
      p_delta: amount.toString()
    }));
    return;
  }
  if (!pool) return;
  await pool.query(
    "update launches set volume_eth = volume_eth + $3 where scope = $1 and id = $2",
    [scope, launchId.toString(), amount.toString()]
  );
}

async function refreshLaunchVolume(scope: string, launchId: bigint) {
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().rpc("refresh_launch_volume", {
      p_scope: scope,
      p_launch_id: launchId.toString()
    }));
    return;
  }
  if (!pool) return;
  await pool.query("select refresh_launch_volume($1, $2)", [scope, launchId.toString()]);
}

export async function markGraduated(scope: string, input: { launchId: bigint; token: string; positionId: string; poolId?: string; txHash: string; blockNumber?: bigint }) {
  if (hasSupabaseConfig()) {
    await runSupabase(
      getSupabase()
        .from("graduations")
        .upsert(
          {
            scope,
            launch_id: input.launchId.toString(),
            token: input.token,
            position_id: input.positionId,
            pool_id: input.poolId || null,
            tx_hash: input.txHash,
            block_number: input.blockNumber?.toString()
          },
          { onConflict: "scope,launch_id", ignoreDuplicates: true }
        )
    );
    const launchUpdate = await getSupabase()
      .from("launches")
      .update({ status: "graduated", position_id: input.positionId })
      .eq("id", input.launchId.toString())
      .eq("scope", scope);
    if (launchUpdate.error) {
      await runSupabase(
        getSupabase()
          .from("launches")
          .update({ status: "graduated" })
          .eq("id", input.launchId.toString())
          .eq("scope", scope)
      );
    }
    return;
  }

  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into graduations (scope, launch_id, token, position_id, pool_id, tx_hash, block_number)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (scope, launch_id) do update set pool_id = coalesce(excluded.pool_id, graduations.pool_id)`,
    [scope, input.launchId.toString(), input.token, input.positionId, input.poolId || null, input.txHash, input.blockNumber?.toString()]
  );
  await pool.query("update launches set status = 'graduated', position_id = $3 where scope = $1 and id = $2", [
    scope,
    input.launchId.toString(),
    input.positionId
  ]);
}

export async function getGraduatedLaunches(scope: string): Promise<Array<{ launchId: bigint; token: string; poolId?: string; blockNumber?: bigint }>> {
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase()
      .from("graduations")
      .select("launch_id, token, pool_id, block_number")
      .eq("scope", scope);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      launchId: BigInt(String(row.launch_id)),
      token: String(row.token),
      poolId: row.pool_id ? String(row.pool_id) : undefined,
      blockNumber: row.block_number ? BigInt(String(row.block_number)) : undefined
    }));
  }

  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query(
    "select launch_id, token, pool_id, block_number from graduations where scope = $1",
    [scope]
  );
  return result.rows.map((row) => ({
    launchId: BigInt(String(row.launch_id)),
    token: String(row.token),
    poolId: row.pool_id ? String(row.pool_id) : undefined,
    blockNumber: row.block_number ? BigInt(String(row.block_number)) : undefined
  }));
}

export async function upsertNFTCollection(input: {
  chainId: number;
  collectionId: bigint;
  collection: string;
  factory: string;
  creator: string;
  name: string;
  symbol: string;
  standard?: "ERC1155" | "ERC721";
  contractURI: string;
  initialTokenId: bigint;
  initialMaxSupply: bigint;
  royaltyBps: number;
  txHash: string;
  blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId,
    collection_id: input.collectionId.toString(),
    collection: input.collection.toLowerCase(),
    factory: input.factory.toLowerCase(),
    creator: input.creator.toLowerCase(),
    name: input.name,
    symbol: input.symbol,
    standard: input.standard || "ERC1155",
    contract_uri: input.contractURI,
    initial_token_id: input.initialTokenId.toString(),
    initial_max_supply: input.initialMaxSupply.toString(),
    royalty_bps: input.royaltyBps,
    created_tx: input.txHash,
    created_block: input.blockNumber?.toString()
  };
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_collections").upsert(row, { onConflict: "chain_id,collection" }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into nft_collections (
       chain_id, collection_id, collection, factory, creator, name, symbol, standard, contract_uri,
       initial_token_id, initial_max_supply, royalty_bps, created_tx, created_block
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (chain_id, collection) do update set
       name = excluded.name, symbol = excluded.symbol, standard = excluded.standard, contract_uri = excluded.contract_uri,
       royalty_bps = excluded.royalty_bps, created_block = excluded.created_block`,
    Object.values(row)
  );
}

export async function getNFTCollectionAddresses(chainId: number): Promise<`0x${string}`[]> {
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().from("nft_collections").select("collection").eq("chain_id", chainId);
    if (error) throw error;
    return (data ?? []).map((row) => String(row.collection) as `0x${string}`);
  }
  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query("select collection from nft_collections where chain_id=$1", [chainId]);
  return result.rows.map((row) => String(row.collection) as `0x${string}`);
}

export async function getNFTCollectionStandards(chainId: number): Promise<Array<{ collection: `0x${string}`; standard: string }>> {
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().from("nft_collections").select("collection,standard").eq("chain_id", chainId);
    if (error) throw error;
    return (data ?? []).map((row) => ({ collection: String(row.collection) as `0x${string}`, standard: String(row.standard) }));
  }
  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query("select collection,standard from nft_collections where chain_id=$1", [chainId]);
  return result.rows.map((row) => ({ collection: String(row.collection) as `0x${string}`, standard: String(row.standard) }));
}

export async function applyNFTTransfer(input: { chainId: number; collection: string; tokenId: bigint; from: string; to: string; quantity: bigint; txHash: string; logIndex: number; batchIndex: number; blockNumber: bigint }) {
  const args = {
    p_chain_id: input.chainId, p_collection: input.collection, p_token_id: input.tokenId.toString(),
    p_from: input.from, p_to: input.to, p_quantity: input.quantity.toString(), p_tx_hash: input.txHash,
    p_log_index: input.logIndex, p_batch_index: input.batchIndex, p_block_number: input.blockNumber.toString()
  };
  if (hasSupabaseConfig()) { const { error } = await getSupabase().rpc("apply_nft_transfer", args); if (error) throw error; return; }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query("select apply_nft_transfer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", Object.values(args));
}

export async function upsertNFTItem(input: {
  chainId: number;
  collection: string;
  tokenId: bigint;
  maxSupply: bigint;
  metadataURI: string;
  txHash?: string;
  blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId,
    collection: input.collection.toLowerCase(),
    token_id: input.tokenId.toString(),
    max_supply: input.maxSupply.toString(),
    metadata_uri: input.metadataURI,
    created_tx: input.txHash || null,
    created_block: input.blockNumber?.toString() || null
  };
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_items").upsert(row, { onConflict: "chain_id,collection,token_id" }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into nft_items (chain_id, collection, token_id, max_supply, metadata_uri, created_tx, created_block)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (chain_id, collection, token_id) do update set
       max_supply = excluded.max_supply, metadata_uri = excluded.metadata_uri`,
    Object.values(row)
  );
}

export async function upsertNFTPhase(input: {
  chainId: number;
  collection: string;
  tokenId: bigint;
  phaseId: bigint;
  phaseType: number;
  limitMode: number;
  currency: string;
  mintPrice: bigint;
  startTime: bigint;
  endTime: bigint;
  phaseSupplyCap: bigint;
  defaultWalletLimit: bigint;
  maxPerTransaction: bigint;
  merkleRoot: string;
  txHash?: string;
  blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId,
    collection: input.collection.toLowerCase(),
    token_id: input.tokenId.toString(),
    phase_id: input.phaseId.toString(),
    phase_type: input.phaseType,
    limit_mode: input.limitMode,
    currency: input.currency.toLowerCase(),
    mint_price: input.mintPrice.toString(),
    start_time: input.startTime.toString(),
    end_time: input.endTime.toString(),
    phase_supply_cap: input.phaseSupplyCap.toString(),
    default_wallet_limit: input.defaultWalletLimit.toString(),
    max_per_transaction: input.maxPerTransaction.toString(),
    merkle_root: input.merkleRoot,
    cancelled: false,
    created_tx: input.txHash || null,
    created_block: input.blockNumber?.toString() || null,
    updated_at: new Date().toISOString()
  };
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_mint_phases").upsert(row, { onConflict: "chain_id,collection,token_id,phase_id" }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into nft_mint_phases (
       chain_id, collection, token_id, phase_id, phase_type, limit_mode, currency, mint_price,
       start_time, end_time, phase_supply_cap, default_wallet_limit, max_per_transaction,
       merkle_root, cancelled, created_tx, created_block, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
     on conflict (chain_id, collection, token_id, phase_id) do update set
       phase_type=excluded.phase_type, limit_mode=excluded.limit_mode, currency=excluded.currency,
       mint_price=excluded.mint_price, start_time=excluded.start_time, end_time=excluded.end_time,
       phase_supply_cap=excluded.phase_supply_cap, default_wallet_limit=excluded.default_wallet_limit,
       max_per_transaction=excluded.max_per_transaction, merkle_root=excluded.merkle_root,
       cancelled=false, updated_at=now()`,
    Object.values(row).slice(0, 17)
  );
}

export async function cancelNFTPhase(chainId: number, collection: string, tokenId: bigint, phaseId: bigint) {
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_mint_phases").update({ cancelled: true, updated_at: new Date().toISOString() })
      .eq("chain_id", chainId).eq("collection", collection.toLowerCase()).eq("token_id", tokenId.toString()).eq("phase_id", phaseId.toString()));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    "update nft_mint_phases set cancelled=true, updated_at=now() where chain_id=$1 and collection=$2 and token_id=$3 and phase_id=$4",
    [chainId, collection.toLowerCase(), tokenId.toString(), phaseId.toString()]
  );
}

export async function insertNFTMint(input: {
  chainId: number;
  collection: string;
  tokenId: bigint;
  phaseId: bigint;
  payer: string;
  recipient: string;
  quantity: bigint;
  unitPrice: bigint;
  grossAmount: bigint;
  platformFee: bigint;
  txHash: string;
  logIndex: number;
  blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId,
    collection: input.collection.toLowerCase(),
    token_id: input.tokenId.toString(),
    phase_id: input.phaseId.toString(),
    payer: input.payer.toLowerCase(),
    recipient: input.recipient.toLowerCase(),
    quantity: input.quantity.toString(),
    unit_price: input.unitPrice.toString(),
    gross_amount: input.grossAmount.toString(),
    platform_fee: input.platformFee.toString(),
    tx_hash: input.txHash,
    log_index: input.logIndex,
    block_number: input.blockNumber?.toString() || null
  };
  if (hasSupabaseConfig()) {
    const result = await getSupabase().from("nft_mints").upsert(row, { onConflict: "chain_id,tx_hash,log_index", ignoreDuplicates: true }).select("tx_hash");
    if (result.error) throw result.error;
    if ((result.data ?? []).length > 0) {
      await runSupabase(getSupabase().rpc("increment_nft_lifetime_minted", {
        p_chain_id: input.chainId,
        p_collection: input.collection.toLowerCase(),
        p_token_id: input.tokenId.toString(),
        p_quantity: input.quantity.toString()
      }));
    }
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  const inserted = await pool.query(
    `insert into nft_mints (
       chain_id, collection, token_id, phase_id, payer, recipient, quantity, unit_price,
       gross_amount, platform_fee, tx_hash, log_index, block_number
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (chain_id, tx_hash, log_index) do nothing returning tx_hash`,
    Object.values(row)
  );
  if ((inserted.rowCount ?? 0) > 0) {
    await pool.query(
      "update nft_items set lifetime_minted = lifetime_minted + $4 where chain_id=$1 and collection=$2 and token_id=$3",
      [input.chainId, input.collection.toLowerCase(), input.tokenId.toString(), input.quantity.toString()]
    );
  }
}

export async function upsertNFTListing(input: {
  chainId: number; marketplace: string; listingId: bigint; seller: string; collection: string; tokenId: bigint;
  quantity: bigint; unitPrice: bigint; startTime: bigint; endTime: bigint; txHash: string; blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId, marketplace: input.marketplace.toLowerCase(), listing_id: input.listingId.toString(), seller: input.seller.toLowerCase(),
    collection: input.collection.toLowerCase(), token_id: input.tokenId.toString(),
    original_quantity: input.quantity.toString(), remaining_quantity: input.quantity.toString(),
    unit_price: input.unitPrice.toString(), start_time: input.startTime.toString(), end_time: input.endTime.toString(),
    cancelled: false, created_tx: input.txHash, created_block: input.blockNumber?.toString() || null,
    updated_at: new Date().toISOString()
  };
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_listings").upsert(row, { onConflict: "chain_id,marketplace,listing_id", ignoreDuplicates: true }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into nft_listings (chain_id,marketplace,listing_id,seller,collection,token_id,original_quantity,remaining_quantity,unit_price,start_time,end_time,cancelled,created_tx,created_block,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     on conflict (chain_id,marketplace,listing_id) do nothing`, Object.values(row).slice(0, 14)
  );
}

export async function cancelNFTListing(chainId: number, marketplace: string, listingId: bigint) {
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_listings").update({ cancelled: true, updated_at: new Date().toISOString() })
      .eq("chain_id", chainId).eq("marketplace", marketplace.toLowerCase()).eq("listing_id", listingId.toString()));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query("update nft_listings set cancelled=true, updated_at=now() where chain_id=$1 and marketplace=$2 and listing_id=$3", [chainId, marketplace.toLowerCase(), listingId.toString()]);
}

export async function insertNFTSale(input: {
  chainId: number; marketplace: string; listingId: bigint; buyer: string; recipient: string; quantity: bigint;
  grossAmount: bigint; platformFee: bigint; royaltyRecipient: string; royaltyAmount: bigint;
  txHash: string; logIndex: number; blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId, marketplace: input.marketplace.toLowerCase(), listing_id: input.listingId.toString(), buyer: input.buyer.toLowerCase(),
    recipient: input.recipient.toLowerCase(), quantity: input.quantity.toString(), gross_amount: input.grossAmount.toString(),
    platform_fee: input.platformFee.toString(), royalty_recipient: input.royaltyRecipient.toLowerCase(),
    royalty_amount: input.royaltyAmount.toString(), tx_hash: input.txHash, log_index: input.logIndex,
    block_number: input.blockNumber?.toString() || null
  };
  if (hasSupabaseConfig()) {
    const result = await getSupabase().from("nft_sales").upsert(row, { onConflict: "chain_id,tx_hash,log_index", ignoreDuplicates: true }).select("tx_hash");
    if (result.error) throw result.error;
    if ((result.data ?? []).length) await runSupabase(getSupabase().rpc("apply_nft_sale", {
      p_chain_id: input.chainId, p_marketplace: input.marketplace.toLowerCase(), p_listing_id: input.listingId.toString(), p_quantity: input.quantity.toString()
    }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query(
    `insert into nft_sales (chain_id,marketplace,listing_id,buyer,recipient,quantity,gross_amount,platform_fee,royalty_recipient,royalty_amount,tx_hash,log_index,block_number)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (chain_id,tx_hash,log_index) do nothing returning tx_hash`,
    Object.values(row)
  );
  if ((result.rowCount ?? 0) > 0) await pool.query(
    "update nft_listings set remaining_quantity=greatest(remaining_quantity-$4,0), updated_at=now() where chain_id=$1 and marketplace=$2 and listing_id=$3",
    [input.chainId, input.marketplace.toLowerCase(), input.listingId.toString(), input.quantity.toString()]
  );
}

export async function cancelNFTOffer(chainId: number, offersContract: string, offerHash: string) {
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().from("nft_offers").update({ cancelled: true, updated_at: new Date().toISOString() })
      .eq("chain_id", chainId).eq("offers_contract", offersContract.toLowerCase()).eq("offer_hash", offerHash.toLowerCase()));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query("update nft_offers set cancelled=true,updated_at=now() where chain_id=$1 and offers_contract=$2 and offer_hash=$3", [chainId, offersContract.toLowerCase(), offerHash.toLowerCase()]);
}

export async function applyNFTOfferNonceFloor(chainId: number, offersContract: string, maker: string, minimumNonce: bigint) {
  if (hasSupabaseConfig()) {
    await runSupabase(getSupabase().rpc("apply_nft_offer_nonce_floor", {
      p_chain_id: chainId, p_offers_contract: offersContract.toLowerCase(), p_maker: maker.toLowerCase(), p_minimum_nonce: minimumNonce.toString()
    }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into nft_offer_nonce_floors(chain_id,offers_contract,maker,minimum_nonce) values($1,$2,$3,$4)
     on conflict(chain_id,offers_contract,maker) do update set minimum_nonce=greatest(nft_offer_nonce_floors.minimum_nonce,excluded.minimum_nonce),updated_at=now()`,
    [chainId, offersContract.toLowerCase(), maker.toLowerCase(), minimumNonce.toString()]
  );
  await pool.query("update nft_offers set cancelled=true,updated_at=now() where chain_id=$1 and offers_contract=$2 and maker=$3 and nonce<$4", [chainId, offersContract.toLowerCase(), maker.toLowerCase(), minimumNonce.toString()]);
}

export async function insertNFTOfferFill(input: {
  chainId: number; offersContract: string; offerHash: string; maker: string; seller: string; collection: string; tokenId: bigint;
  quantity: bigint; grossAmount: bigint; platformFee: bigint; royaltyRecipient: string; royaltyAmount: bigint;
  standard: number; offerType: number; txHash: string; logIndex: number; blockNumber?: bigint;
}) {
  const row = {
    chain_id: input.chainId, offers_contract: input.offersContract.toLowerCase(), offer_hash: input.offerHash.toLowerCase(), maker: input.maker.toLowerCase(),
    seller: input.seller.toLowerCase(), collection: input.collection.toLowerCase(), token_id: input.tokenId.toString(),
    quantity: input.quantity.toString(), gross_amount: input.grossAmount.toString(), platform_fee: input.platformFee.toString(),
    royalty_recipient: input.royaltyRecipient.toLowerCase(), royalty_amount: input.royaltyAmount.toString(),
    standard: input.standard, offer_type: input.offerType, tx_hash: input.txHash, log_index: input.logIndex,
    block_number: input.blockNumber?.toString() || null
  };
  if (hasSupabaseConfig()) {
    const result = await getSupabase().from("nft_offer_fills").upsert(row, { onConflict: "chain_id,tx_hash,log_index", ignoreDuplicates: true }).select("tx_hash");
    if (result.error) throw result.error;
    if ((result.data || []).length) await runSupabase(getSupabase().rpc("apply_nft_offer_fill", {
      p_chain_id: input.chainId, p_offers_contract: input.offersContract.toLowerCase(), p_offer_hash: input.offerHash.toLowerCase(), p_quantity: input.quantity.toString()
    }));
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query(
    `insert into nft_offer_fills(chain_id,offers_contract,offer_hash,maker,seller,collection,token_id,quantity,gross_amount,platform_fee,royalty_recipient,royalty_amount,standard,offer_type,tx_hash,log_index,block_number)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict(chain_id,tx_hash,log_index) do nothing returning tx_hash`,
    Object.values(row)
  );
  if ((result.rowCount || 0) > 0) await pool.query(
    "update nft_offers set filled_quantity=least(quantity,filled_quantity+$4),updated_at=now() where chain_id=$1 and offers_contract=$2 and offer_hash=$3",
    [input.chainId, input.offersContract.toLowerCase(), input.offerHash.toLowerCase(), input.quantity.toString()]
  );
}

export async function getIndexerState(key: string): Promise<bigint | undefined> {
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().from("indexer_state").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.value ? BigInt(data.value) : undefined;
  }

  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query("select value from indexer_state where key = $1", [key]);
  if (!result.rowCount) return undefined;
  return BigInt(result.rows[0].value);
}

export async function setIndexerState(key: string, value: bigint) {
  if (hasSupabaseConfig()) {
    await runSupabase(
      getSupabase()
        .from("indexer_state")
        .upsert({ key, value: value.toString(), updated_at: new Date().toISOString() }, { onConflict: "key" })
    );
    return;
  }

  if (!pool) throw new Error("Database client is not configured");
  await pool.query(
    `insert into indexer_state (key, value, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value.toString()]
  );
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabase() {
  supabase ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as never }
  });
  return supabase;
}

async function runSupabase<T>(query: PromiseLike<{ data: T | null; error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
  supabase = undefined;
}
