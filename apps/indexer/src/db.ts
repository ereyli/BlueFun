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
       website_url, twitter_url, telegram_url, discord_url, created_tx, created_block
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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

export async function markGraduated(scope: string, input: { launchId: bigint; token: string; positionId: string; txHash: string; blockNumber?: bigint }) {
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
    `insert into graduations (scope, launch_id, token, position_id, tx_hash, block_number)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (scope, launch_id) do nothing`,
    [scope, input.launchId.toString(), input.token, input.positionId, input.txHash, input.blockNumber?.toString()]
  );
  await pool.query("update launches set status = 'graduated', position_id = $3 where scope = $1 and id = $2", [
    scope,
    input.launchId.toString(),
    input.positionId
  ]);
}

export async function getGraduatedLaunches(scope: string): Promise<Array<{ launchId: bigint; token: string; blockNumber?: bigint }>> {
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase()
      .from("graduations")
      .select("launch_id, token, block_number")
      .eq("scope", scope);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      launchId: BigInt(String(row.launch_id)),
      token: String(row.token),
      blockNumber: row.block_number ? BigInt(String(row.block_number)) : undefined
    }));
  }

  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query(
    "select launch_id, token, block_number from graduations where scope = $1",
    [scope]
  );
  return result.rows.map((row) => ({
    launchId: BigInt(String(row.launch_id)),
    token: String(row.token),
    blockNumber: row.block_number ? BigInt(String(row.block_number)) : undefined
  }));
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
