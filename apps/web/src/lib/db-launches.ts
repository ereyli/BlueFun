import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { formatEther, getAddress } from "viem";
import WebSocket from "ws";
import { contractsForChain, indexerScopeForLaunch, indexerScopesForChain } from "@/lib/contracts";
import type { DeployedLaunch, DeployedTrade } from "@/lib/onchain-launches";
import type { WalletDashboardData, WalletTradeSummary } from "@/lib/dashboard-types";
import type { BlueStakingOverview } from "@/lib/blue-staking";
import { readTokenMetadata } from "@/lib/token-metadata";

let pool: pg.Pool | undefined;
let supabase: SupabaseClient | undefined;

export type DbLaunchMetrics = {
  totalVolumeEth: number;
  totalTokens: number;
  totalCreators: number;
  totalGraduated: number;
};

export type LaunchBuyActivity = {
  scope: string;
  launchId: string;
  blockNumber: string;
  createdAt: string;
  marketCapNative?: string;
};

export type LaunchPageFilter = "All" | "New" | "Volume" | "MarketCap" | "Newest" | "Direct" | "Live" | "Ready" | "Graduated" | "Progress";
export type DbLaunchPage = { launches: DeployedLaunch[]; total: number };

function databaseIntegerString(value: unknown) {
  const input = String(value ?? "0").trim();
  if (/^\d+$/.test(input)) return input.replace(/^0+(?=\d)/, "");

  const scientific = input.match(/^\+?(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (scientific) {
    const whole = scientific[1];
    const fraction = scientific[2] || "";
    const exponent = Number(scientific[3]);
    const digits = `${whole}${fraction}`;
    const integerLength = whole.length + exponent;
    if (Number.isSafeInteger(integerLength) && integerLength >= digits.length) {
      return `${digits}${"0".repeat(integerLength - digits.length)}`.replace(/^0+(?=\d)/, "");
    }
  }

  const decimal = input.match(/^\+?(\d+)\.0+$/);
  return decimal ? decimal[1].replace(/^0+(?=\d)/, "") : "0";
}

function databaseStakers(value: unknown): BlueStakingOverview["stakers"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.address !== "string") return [];
    return [{
      address: row.address,
      activeRaw: databaseIntegerString(row.activeRaw),
      coolingRaw: databaseIntegerString(row.coolingRaw),
      earnedRaw: databaseIntegerString(row.earnedRaw),
      cooldownEnd: Number(row.cooldownEnd || 0),
      shareBps: Number(row.shareBps || 0),
      projectedRemainingRaw: databaseIntegerString(row.projectedRemainingRaw)
    }];
  });
}

export async function getDbBlueStakingOverview(chainId: number, vault: string): Promise<BlueStakingOverview | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  try {
    let row: Record<string, unknown> | undefined;
    if (hasSupabaseConfig()) {
      const { data, error } = await getSupabase()
        .from("staking_snapshots")
        .select("*")
        .eq("chain_id", chainId)
        .eq("vault", vault.toLowerCase())
        .maybeSingle();
      if (error) throw error;
      row = data as Record<string, unknown> | undefined;
    } else {
      if (!process.env.DATABASE_URL) return undefined;
      pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 500, idleTimeoutMillis: 1_000, max: 2 });
      const result = await withTimeout(pool.query(
        "select * from staking_snapshots where chain_id = $1 and vault = $2 limit 1",
        [chainId, vault.toLowerCase()]
      ), 500);
      row = result.rows[0] as Record<string, unknown> | undefined;
    }
    if (!row) return undefined;
    const updatedAt = String(row.updated_at || "");
    const updatedTimestamp = new Date(updatedAt).getTime();
    const isStale = !Number.isFinite(updatedTimestamp) || Date.now() - updatedTimestamp > 90_000;
    return {
      updatedAt,
      indexedBlock: String(row.indexed_block || "0"),
      source: "indexer",
      isStale,
      totalActiveRaw: databaseIntegerString(row.total_active),
      totalCoolingRaw: databaseIntegerString(row.total_cooling),
      rewardBalanceRaw: databaseIntegerString(row.reward_balance),
      queuedRewardsRaw: databaseIntegerString(row.queued_rewards),
      remainingRewardsRaw: databaseIntegerString(row.remaining_rewards),
      rewardRateRaw: databaseIntegerString(row.reward_rate),
      rewardsDuration: Number(row.rewards_duration || 0),
      periodFinish: Number(row.period_finish || 0),
      stakingShareBps: Number(row.staking_share_bps || 0),
      lifetimeFundedRaw: databaseIntegerString(row.lifetime_funded),
      lifetimeClaimedRaw: databaseIntegerString(row.lifetime_claimed),
      uniqueStakers: Number(row.unique_stakers || 0),
      activeStakers: Number(row.active_stakers || 0),
      paused: Boolean(row.paused),
      emergency: Boolean(row.emergency),
      stakers: databaseStakers(row.stakers)
    };
  } catch (error) {
    console.error("Failed to read staking snapshot from database", error);
    return undefined;
  }
}

const launchColumns = "scope, id, token, creator, name, symbol, contract_uri, image_url, description, website_url, twitter_url, telegram_url, discord_url, status, launch_mode, pool_fee, tick_spacing, liquidity_locker, raised_eth, graduation_target_eth, progress, volume_eth, token_created_at, created_block, position_id";
const legacyLaunchColumns = "scope, id, token, creator, name, symbol, contract_uri, status, raised_eth, graduation_target_eth, progress, volume_eth, token_created_at, created_block";

export async function getDbWalletDashboard(wallet: `0x${string}`): Promise<WalletDashboardData | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;

  try {
    const created: DeployedLaunch[] = [];
    const traded: WalletTradeSummary[] = [];

    for (const chainId of [8453, 4663, 143]) {
      const context = dbContext(chainId);
      let creatorRows: Array<Record<string, unknown>> = [];
      let tradeRows: Array<Record<string, unknown>> = [];

      if (hasSupabaseConfig()) {
        let creatorResponse: {
          data: Array<Record<string, unknown>> | null;
          error: { message?: string; details?: string } | null;
        } = await getSupabase().from("launches")
          .select(launchColumns)
          .in("scope", context.scopes)
          .gte("created_block", context.deploymentBlock)
          .ilike("creator", wallet)
          .order("created_block", { ascending: false })
          .limit(500);
        if (creatorResponse.error && isMissingSocialColumnError(creatorResponse.error)) {
          creatorResponse = await getSupabase().from("launches")
            .select(legacyLaunchColumns)
            .in("scope", context.scopes)
            .gte("created_block", context.deploymentBlock)
            .ilike("creator", wallet)
            .order("created_block", { ascending: false })
            .limit(500);
        }
        if (creatorResponse.error) throw creatorResponse.error;
        creatorRows = creatorResponse.data ?? [];

        const tradeResponse = await getSupabase().from("trades")
          .select("scope, launch_id, side, eth_amount, token_amount, block_number, created_at")
          .in("scope", context.scopes)
          .ilike("trader", wallet)
          .order("block_number", { ascending: false })
          .limit(5000);
        if (tradeResponse.error) throw tradeResponse.error;
        tradeRows = (tradeResponse.data ?? []) as Array<Record<string, unknown>>;
      } else {
        if (!process.env.DATABASE_URL) return undefined;
        pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 750, idleTimeoutMillis: 5_000, max: 5 });
        const [creatorResult, tradeResult] = await Promise.all([
          withTimeout(pool.query(
            `select ${launchColumns}
             from launches
             where scope = any($1::text[]) and created_block >= $2 and lower(creator) = lower($3)
             order by created_block desc limit 500`,
            [context.scopes, context.deploymentBlock, wallet]
          ), 1_500),
          withTimeout(pool.query(
            `select scope, launch_id, side, eth_amount, token_amount, block_number, created_at
             from trades
             where scope = any($1::text[]) and lower(trader) = lower($2)
             order by block_number desc limit 5000`,
            [context.scopes, wallet]
          ), 1_500)
        ]);
        creatorRows = creatorResult.rows;
        tradeRows = tradeResult.rows;
      }

      created.push(...await mapRows(creatorRows, chainId));
      if (!tradeRows.length) continue;

      const launchIds = Array.from(new Set(tradeRows.map((row) => String(row.launch_id))));
      let launchRows: Array<Record<string, unknown>> = [];
      if (hasSupabaseConfig()) {
        let launchResponse: {
          data: Array<Record<string, unknown>> | null;
          error: { message?: string; details?: string } | null;
        } = await getSupabase().from("launches")
          .select(launchColumns)
          .in("scope", context.scopes)
          .in("id", launchIds);
        if (launchResponse.error && isMissingSocialColumnError(launchResponse.error)) {
          launchResponse = await getSupabase().from("launches")
            .select(legacyLaunchColumns)
            .in("scope", context.scopes)
            .in("id", launchIds);
        }
        if (launchResponse.error) throw launchResponse.error;
        launchRows = launchResponse.data ?? [];
      } else {
        const result = await withTimeout(pool!.query(
          `select ${launchColumns} from launches where scope = any($1::text[]) and id = any($2::numeric[])`,
          [context.scopes, launchIds]
        ), 1_500);
        launchRows = result.rows;
      }

      const mappedLaunches = await mapRows(launchRows, chainId);
      const launchMap = new Map(mappedLaunches.map((launch) => [`${launch.scope}:${launch.id}`, launch]));
      const summaries = new Map<string, Omit<WalletTradeSummary, "launch">>();
      for (const row of tradeRows) {
        const key = `${String(row.scope)}:${String(row.launch_id)}`;
        const current = summaries.get(key) ?? {
          buyCount: 0,
          sellCount: 0,
          boughtTokens: "0",
          soldTokens: "0",
          spentNative: "0",
          receivedNative: "0",
          lastTradeAt: String(row.created_at || "") || undefined
        };
        const isSell = row.side === "sell";
        current[isSell ? "sellCount" : "buyCount"] += 1;
        current[isSell ? "soldTokens" : "boughtTokens"] = (BigInt(current[isSell ? "soldTokens" : "boughtTokens"]) + parseDbBigInt(row.token_amount)).toString();
        current[isSell ? "receivedNative" : "spentNative"] = (BigInt(current[isSell ? "receivedNative" : "spentNative"]) + parseDbBigInt(row.eth_amount)).toString();
        summaries.set(key, current);
      }
      for (const [key, summary] of summaries) {
        const launch = launchMap.get(key);
        if (launch) traded.push({ launch, ...summary });
      }
    }

    return { created, traded, indexed: true };
  } catch (error) {
    console.error("Failed to read wallet dashboard from database", error);
    return undefined;
  }
}

export async function getDbLaunchPage(
  chainId = 8453,
  options: { page?: number; pageSize?: number; query?: string; filter?: LaunchPageFilter } = {}
): Promise<DbLaunchPage | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const context = dbContext(chainId);
  const page = Math.max(1, Math.floor(options.page || 1));
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 21), 1), 21);
  const offset = (page - 1) * pageSize;
  const search = normalizeSearchTerm(options.query);
  const filter = options.filter || "All";
  const statusFilter = filter === "Live" || filter === "Ready" || filter === "Graduated" ? filter.toLowerCase() : "";

  try {
    if (hasSupabaseConfig()) {
      let query = getSupabase().from("launches")
        .select(launchColumns, { count: "exact" })
        .in("scope", context.scopes)
        .gte("created_block", context.deploymentBlock);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (filter === "Direct") query = query.eq("launch_mode", "direct");
      if (filter === "Graduated" || filter === "Progress") query = query.neq("launch_mode", "direct");
      if (search) query = query.or(`name.ilike.%${search}%,symbol.ilike.%${search}%,token.ilike.%${search}%,creator.ilike.%${search}%`);
      query = filter === "Progress"
        ? query.order("progress", { ascending: false }).order("created_block", { ascending: false }).order("id", { ascending: false })
        : filter === "Volume"
          ? query.order("volume_eth", { ascending: false }).order("created_block", { ascending: false })
          : filter === "MarketCap"
            ? query.order("raised_eth", { ascending: false }).order("created_block", { ascending: false })
            : filter === "All"
              ? query.order("volume_eth", { ascending: false }).order("raised_eth", { ascending: false }).order("created_block", { ascending: false })
            : query.order("created_block", { ascending: false }).order("id", { ascending: false });
      let response: {
        data: Array<Record<string, unknown>> | null;
        error: { message?: string; details?: string } | null;
        count: number | null;
      } = await query.range(offset, offset + pageSize - 1);

      if (response.error && isMissingSocialColumnError(response.error)) {
        let legacyQuery = getSupabase().from("launches")
          .select(legacyLaunchColumns, { count: "exact" })
          .in("scope", context.scopes)
          .gte("created_block", context.deploymentBlock);
        if (statusFilter) legacyQuery = legacyQuery.eq("status", statusFilter);
        if (filter === "Direct") legacyQuery = legacyQuery.eq("launch_mode", "direct");
        if (filter === "Graduated" || filter === "Progress") legacyQuery = legacyQuery.neq("launch_mode", "direct");
        if (search) legacyQuery = legacyQuery.or(`name.ilike.%${search}%,symbol.ilike.%${search}%,token.ilike.%${search}%,creator.ilike.%${search}%`);
        legacyQuery = filter === "Progress"
          ? legacyQuery.order("progress", { ascending: false }).order("created_block", { ascending: false }).order("id", { ascending: false })
          : filter === "Volume"
            ? legacyQuery.order("volume_eth", { ascending: false }).order("created_block", { ascending: false })
            : filter === "MarketCap"
              ? legacyQuery.order("raised_eth", { ascending: false }).order("created_block", { ascending: false })
              : filter === "All"
                ? legacyQuery.order("volume_eth", { ascending: false }).order("raised_eth", { ascending: false }).order("created_block", { ascending: false })
              : legacyQuery.order("created_block", { ascending: false }).order("id", { ascending: false });
        response = await legacyQuery.range(offset, offset + pageSize - 1);
      }
      if (response.error) throw response.error;
      return { launches: await mapRows((response.data ?? []) as Array<Record<string, unknown>>, context.chainId), total: response.count ?? 0 };
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 750, idleTimeoutMillis: 5_000, max: 5 });
    const result = await withTimeout(pool.query(
      `select scope, id, token, creator, name, symbol, contract_uri, image_url, description,
              website_url, twitter_url, telegram_url, discord_url, status, launch_mode, pool_fee,
              tick_spacing, liquidity_locker, raised_eth,
              graduation_target_eth, progress, volume_eth, token_created_at, created_block, position_id,
              count(*) over() as total_count
       from launches
       where scope = any($1::text[]) and created_block >= $2
         and ($3 = '' or status = $3)
         and ($4 = '' or name ilike '%' || $4 || '%' or symbol ilike '%' || $4 || '%'
           or token ilike '%' || $4 || '%' or creator ilike '%' || $4 || '%')
         and ($5 <> 'Direct' or launch_mode = 'direct')
         and ($5 <> 'Graduated' or launch_mode <> 'direct')
         and ($5 <> 'Progress' or launch_mode <> 'direct')
       order by case when $5 = 'Progress' then progress end desc,
                case when $5 = 'Volume' then volume_eth end desc,
                case when $5 = 'MarketCap' then raised_eth end desc,
                case when $5 = 'All' then volume_eth end desc,
                case when $5 = 'All' then raised_eth end desc,
                created_block desc, id desc
       limit $6 offset $7`,
      [context.scopes, context.deploymentBlock, statusFilter, search, filter, pageSize, offset]
    ), 1_500);
    return {
      launches: await mapRows(result.rows, context.chainId),
      total: Number(result.rows[0]?.total_count || 0)
    };
  } catch (error) {
    console.error("Failed to read paginated launches from database", error);
    return undefined;
  }
}

export async function getDbLaunches(chainId = 8453, options: { cursor?: string; limit?: number } = {}): Promise<DeployedLaunch[] | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const context = dbContext(chainId);
  const limit = Math.min(Math.max(options.limit || 80, 1), 80);

  try {
    if (hasSupabaseConfig()) {
      let query = getSupabase()
        .from("launches")
        .select(launchColumns)
        .in("scope", context.scopes)
        .gte("created_block", context.deploymentBlock)
        .order("id", { ascending: false })
        .limit(limit);
      if (options.cursor) query = query.lt("id", options.cursor);
      let response: { data: Array<Record<string, unknown>> | null; error: { message?: string; details?: string } | null } = await query;

      if (response.error && isMissingSocialColumnError(response.error)) {
        let legacyQuery = getSupabase()
          .from("launches")
          .select(legacyLaunchColumns)
          .in("scope", context.scopes)
          .gte("created_block", context.deploymentBlock)
          .order("id", { ascending: false })
          .limit(limit);
        if (options.cursor) legacyQuery = legacyQuery.lt("id", options.cursor);
        response = await legacyQuery;
      }

      if (response.error) throw response.error;
      return mapRows(response.data ?? [], context.chainId);
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
      idleTimeoutMillis: 1_000,
      max: 2
    });
    const result = await withTimeout(pool.query(
      `select scope, id, token, creator, name, symbol, contract_uri, image_url, description,
              website_url, twitter_url, telegram_url, discord_url, status, launch_mode, pool_fee,
              tick_spacing, liquidity_locker, raised_eth,
              graduation_target_eth, progress, volume_eth, token_created_at, position_id
       from launches
       where scope = any($1::text[])
         and created_block >= $2
         and ($3::numeric is null or id < $3::numeric)
       order by id desc
       limit $4`
    , [context.scopes, context.deploymentBlock, options.cursor || null, limit]), 1_500);

    return mapRows(result.rows, context.chainId);
  } catch (error) {
    console.error("Failed to read launches from database", error);
    return undefined;
  }
}

export async function getDbLaunch(launchId: string, chainId = 8453): Promise<DeployedLaunch | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const context = dbContext(chainId);
  try {
    if (hasSupabaseConfig()) {
      let response = await getSupabase()
        .from("launches")
        .select(launchColumns)
        .in("scope", context.scopes)
        .eq("id", launchId)
        .gte("created_block", context.deploymentBlock)
        .maybeSingle();
      if (response.error && isMissingSocialColumnError(response.error)) {
        response = await getSupabase()
          .from("launches")
          .select(legacyLaunchColumns)
          .in("scope", context.scopes)
          .eq("id", launchId)
          .gte("created_block", context.deploymentBlock)
          .maybeSingle();
      }
      if (response.error) throw response.error;
      if (!response.data) return undefined;
      const launch = (await mapRows([response.data as Record<string, unknown>], context.chainId))[0];
      return launch ? await attachGraduationPosition(launch, context.scopes) : undefined;
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 750, idleTimeoutMillis: 5_000, max: 5 });
    const result = await withTimeout(pool.query(
      `select scope, id, token, creator, name, symbol, contract_uri, image_url, description,
              website_url, twitter_url, telegram_url, discord_url, status, launch_mode, pool_fee,
              tick_spacing, liquidity_locker, raised_eth,
              graduation_target_eth, progress, volume_eth, token_created_at, created_block, position_id
       from launches
       where scope = any($1::text[]) and id = $2 and created_block >= $3
       limit 1`,
      [context.scopes, launchId, context.deploymentBlock]
    ), 1_500);
    if (!result.rows[0]) return undefined;
    const launch = (await mapRows([result.rows[0]], context.chainId))[0];
    return launch ? await attachGraduationPosition(launch, context.scopes) : undefined;
  } catch (error) {
    console.error("Failed to read launch from database", error);
    return undefined;
  }
}

export async function getDbLaunchByTokenSuffix(tokenSuffix: string, chainId = 8453): Promise<DeployedLaunch | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true" || !/^[a-fA-F0-9]{8}$/.test(tokenSuffix)) return undefined;
  const context = dbContext(chainId);
  const suffix = tokenSuffix.toLowerCase();

  try {
    let rows: Array<Record<string, unknown>>;
    if (hasSupabaseConfig()) {
      let response: { data: Array<Record<string, unknown>> | null; error: { message?: string; details?: string } | null } = await getSupabase()
        .from("launches")
        .select(launchColumns)
        .in("scope", context.scopes)
        .gte("created_block", context.deploymentBlock)
        .ilike("token", `%${suffix}`)
        .limit(2);
      if (response.error && isMissingSocialColumnError(response.error)) {
        response = await getSupabase()
          .from("launches")
          .select(legacyLaunchColumns)
          .in("scope", context.scopes)
          .gte("created_block", context.deploymentBlock)
          .ilike("token", `%${suffix}`)
          .limit(2);
      }
      if (response.error) throw response.error;
      rows = (response.data ?? []) as Array<Record<string, unknown>>;
    } else {
      if (!process.env.DATABASE_URL) return undefined;
      pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 750, idleTimeoutMillis: 5_000, max: 5 });
      const result = await withTimeout(pool.query(
        `select scope, id, token, creator, name, symbol, contract_uri, image_url, description,
                website_url, twitter_url, telegram_url, discord_url, status, launch_mode, pool_fee,
                tick_spacing, liquidity_locker, raised_eth,
                graduation_target_eth, progress, volume_eth, token_created_at, created_block, position_id
         from launches
         where scope = any($1::text[])
           and created_block >= $2
           and right(lower(token), 8) = $3
         limit 2`,
        [context.scopes, context.deploymentBlock, suffix]
      ), 1_500);
      rows = result.rows;
    }

    const exactMatches = rows.filter((row) => String(row.token || "").toLowerCase().endsWith(suffix));
    if (exactMatches.length !== 1) return undefined;
    const launch = (await mapRows(exactMatches, context.chainId))[0];
    return launch ? await attachGraduationPosition(launch, context.scopes) : undefined;
  } catch (error) {
    console.error("Failed to read launch by token suffix", error);
    return undefined;
  }
}

export async function getDbLaunchMetrics(chainId = 8453): Promise<DbLaunchMetrics | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const context = dbContext(chainId);

  try {
    if (hasSupabaseConfig()) {
      const response = await getSupabase().rpc("get_launchpad_metrics", {
        p_scopes: context.scopes,
        p_start_block: context.deploymentBlock
      });
      if (response.error) throw response.error;
      const row = Array.isArray(response.data) ? response.data[0] : response.data;
      return {
        totalVolumeEth: weiToEthNumber(parseDbBigInt(row?.total_volume_eth)),
        totalTokens: Number(row?.total_tokens || 0),
        totalCreators: Number(row?.total_creators || 0),
        totalGraduated: Number(row?.total_graduated || 0)
      };
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
      idleTimeoutMillis: 1_000,
      max: 2
    });
    const result = await withTimeout(pool.query(
      `select
         coalesce((select sum(eth_amount) from trades where scope = any($1::text[]) and block_number >= $2), 0) as total_volume_eth,
         count(*) as total_tokens,
         count(distinct creator) as total_creators,
         count(*) filter (where status = 'graduated') as total_graduated
       from launches
       where scope = any($1::text[]) and created_block >= $2`,
      [context.scopes, context.deploymentBlock]
    ), 300);

    return {
      totalVolumeEth: weiToEthNumber(parseDbBigInt(result.rows[0]?.total_volume_eth)),
      totalTokens: Number(result.rows[0]?.total_tokens || 0),
      totalCreators: Number(result.rows[0]?.total_creators || 0),
      totalGraduated: Number(result.rows[0]?.total_graduated || 0)
    };
  } catch (error) {
    console.error("Failed to read launch metrics from database", error);
    return undefined;
  }
}

function isMissingSocialColumnError(error: { message?: string; details?: string }) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return ["image_url", "description", "website_url", "twitter_url", "telegram_url", "discord_url", "position_id", "launch_mode", "pool_fee", "tick_spacing", "liquidity_locker"].some((column) => text.includes(column));
}

function isMissingTradeColumnError(error: { message?: string; details?: string }) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return text.includes("market_cap_eth") || text.includes("source");
}

export async function getDbTrades(launchId: string, chainId = 8453, launchScope?: string): Promise<DeployedTrade[] | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const context = dbContextForLaunch(chainId, launchId, launchScope);

  try {
    if (hasSupabaseConfig()) {
      let response: { data: Array<Record<string, unknown>> | null; error: { message?: string; details?: string } | null } = await getSupabase()
        .from("trades")
        .select("side, source, trader, eth_amount, token_amount, market_cap_eth, tx_hash, block_number, created_at")
        .eq("scope", context.scope)
        .eq("launch_id", launchId)
        .gte("block_number", context.deploymentBlock)
        .order("block_number", { ascending: false })
        .order("id", { ascending: false })
        .limit(250);

      if (response.error && isMissingTradeColumnError(response.error)) {
        response = await getSupabase()
          .from("trades")
          .select("side, trader, eth_amount, token_amount, tx_hash, block_number, created_at")
          .eq("scope", context.scope)
          .eq("launch_id", launchId)
          .gte("block_number", context.deploymentBlock)
          .order("block_number", { ascending: false })
          .order("id", { ascending: false })
          .limit(250);
      }

      if (response.error) throw response.error;
      return mapTrades(response.data ?? [], chainId);
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
      idleTimeoutMillis: 1_000,
      max: 2
    });
    const result = await withTimeout(pool.query(
      `select side, source, trader, eth_amount, token_amount, market_cap_eth, tx_hash, block_number, created_at
       from trades
       where scope = $1
         and launch_id = $2
         and block_number >= $3
       order by block_number desc, id desc
       limit 250`,
      [context.scope, launchId, context.deploymentBlock]
    ), 300);

    return mapTrades(result.rows, chainId);
  } catch (error) {
    console.error("Failed to read trades from database", error);
    return undefined;
  }
}

export async function getDbRecentBuyActivity(chainId = 8453, limit = 80): Promise<LaunchBuyActivity[] | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const context = dbContext(chainId);
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 120);

  try {
    let rows: Array<Record<string, unknown>>;
    if (hasSupabaseConfig()) {
      const response = await getSupabase()
        .from("trades")
        .select("scope, launch_id, source, eth_amount, token_amount, market_cap_eth, block_number, created_at")
        .in("scope", context.scopes)
        .eq("side", "buy")
        .gte("block_number", context.deploymentBlock)
        .order("block_number", { ascending: false })
        .order("id", { ascending: false })
        .limit(safeLimit);
      if (response.error) throw response.error;
      rows = (response.data ?? []) as Array<Record<string, unknown>>;
    } else {
      if (!process.env.DATABASE_URL) return undefined;
      pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 500, idleTimeoutMillis: 1_000, max: 2 });
      const result = await withTimeout(pool.query(
        `select scope, launch_id, source, eth_amount, token_amount, market_cap_eth, block_number, created_at
         from trades
         where scope = any($1::text[])
           and side = 'buy'
           and block_number >= $2
         order by block_number desc, id desc
         limit $3`,
        [context.scopes, context.deploymentBlock, safeLimit]
      ), 300);
      rows = result.rows;
    }

    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const scope = String(row.scope || "");
      const launchId = String(row.launch_id || "");
      const activityKey = `${scope}:${launchId}`;
      if (!scope || !launchId || seen.has(activityKey)) return [];
      seen.add(activityKey);
      const indexedMarketCap = parseDbBigInt(row.market_cap_eth);
      const tokenAmount = parseDbBigInt(row.token_amount);
      const estimatedMarketCap = indexedMarketCap > 0n
        ? indexedMarketCap
        : row.source === "uniswap_v4" && tokenAmount > 0n
          ? (parseDbBigInt(row.eth_amount) * 1_000_000_000n * 10n ** 18n) / tokenAmount
          : 0n;
      return [{
        scope,
        launchId,
        blockNumber: String(row.block_number || "0"),
        createdAt: String(row.created_at || ""),
        marketCapNative: estimatedMarketCap > 0n ? formatEther(estimatedMarketCap) : undefined
      }];
    });
  } catch (error) {
    console.error("Failed to read recent buy activity", error);
    return undefined;
  }
}

async function mapRows(rows: Array<Record<string, unknown>>, chainId: number): Promise<DeployedLaunch[]> {
  const nativeSymbol = chainId === 143 ? "MON" : "ETH";
  return Promise.all(rows.map(async (row) => {
    const status = toStatus(String(row.status));
    const raised = parseDbBigInt(row.raised_eth);
    const target = parseDbBigInt(row.graduation_target_eth);
    const volume = parseDbBigInt(row.volume_eth);
    const contractURI = String(row.contract_uri || "");
    const storedImage = cleanDbText(row.image_url);
    const metadata = storedImage ? {} : await readTokenMetadata(contractURI);

    return {
      chainId,
      scope: cleanDbText(row.scope),
      launchMode: row.launch_mode === "direct" ? "direct" : "bond",
      poolFee: Number(row.pool_fee || 3000),
      tickSpacing: Number(row.tick_spacing || 60),
      liquidityLocker: row.liquidity_locker ? getAddress(String(row.liquidity_locker)) as `0x${string}` : undefined,
      id: String(row.id),
      token: getAddress(String(row.token)) as `0x${string}`,
      creator: getAddress(String(row.creator)) as `0x${string}`,
      name: String(row.name),
      symbol: String(row.symbol),
      contractURI,
      description: cleanDbText(row.description) || metadata.description,
      imageURI: storedImage || metadata.imageURI,
      website: cleanDbText(row.website_url) || metadata.website,
      twitter: cleanDbText(row.twitter_url) || metadata.twitter,
      telegram: cleanDbText(row.telegram_url) || metadata.telegram,
      discord: cleanDbText(row.discord_url) || metadata.discord,
      positionId: cleanDbText(row.position_id) as `0x${string}` | undefined,
      createdBlock: row.created_block === null || row.created_block === undefined ? undefined : String(row.created_block),
      status,
      raised: `${trimEth(formatEther(raised))} ${nativeSymbol}`,
      target: `${trimEth(formatEther(target))} ${nativeSymbol}`,
      progress: Number(row.progress || 0),
      holders: "indexed",
      volume: `${trimEth(formatEther(volume))} ${nativeSymbol}`,
      age: formatAge(Number(row.token_created_at || 0)),
      risk: row.launch_mode === "direct" ? "Direct DEX · LP locked" : status === "Graduated" ? "Adminless" : chainId === 8453 ? "B20 gated" : "Fixed-supply ERC-20",
      price: "Live",
      marketCap: "Live"
    };
  }));
}

async function attachGraduationPosition(launch: DeployedLaunch, scopes: string[]) {
  if (launch.status !== "Graduated" || launch.positionId) return launch;
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().from("graduations")
      .select("position_id")
      .in("scope", scopes)
      .eq("launch_id", launch.id)
      .maybeSingle();
    if (!error && data?.position_id) launch.positionId = String(data.position_id) as `0x${string}`;
    return launch;
  }
  if (!pool) return launch;
  const result = await pool.query(
    "select position_id from graduations where scope = any($1::text[]) and launch_id = $2 limit 1",
    [scopes, launch.id]
  );
  if (result.rows[0]?.position_id) launch.positionId = String(result.rows[0].position_id) as `0x${string}`;
  return launch;
}

function cleanDbText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean || undefined;
}

function normalizeSearchTerm(value?: string) {
  return (value || "")
    .trim()
    .slice(0, 80)
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .trim();
}

function mapTrades(rows: Array<Record<string, unknown>>, chainId: number): DeployedTrade[] {
  const nativeSymbol = chainId === 143 ? "MON" : "ETH";
  return rows.slice().reverse().map((row) => ({
    side: row.side === "sell" ? "sell" : "buy",
    source: row.source === "uniswap_v4" ? "uniswap_v4" : "curve",
    trader: row.trader ? getAddress(String(row.trader)) as `0x${string}` : undefined,
    ethAmount: `${trimEth(formatEther(parseDbBigInt(row.eth_amount)))} ${nativeSymbol}`,
    tokenAmount: trimEth(formatEther(parseDbBigInt(row.token_amount))),
    marketCapEth: row.market_cap_eth ? formatEther(parseDbBigInt(row.market_cap_eth)) : undefined,
    txHash: String(row.tx_hash || ""),
    blockNumber: String(row.block_number || ""),
    createdAt: String(row.created_at || "")
  }));
}

function parseDbBigInt(value: unknown): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  const raw = String(value).trim();
  if (!raw) return 0n;
  if (!/[eE.]/.test(raw)) return BigInt(raw);

  const [coefficient, exponentPart = "0"] = raw.toLowerCase().split("e");
  const exponent = Number(exponentPart);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";
  const decimalShift = exponent - fraction.length;
  const integerString = decimalShift >= 0
    ? `${digits}${"0".repeat(decimalShift)}`
    : digits.slice(0, Math.max(0, digits.length + decimalShift)) || "0";

  return BigInt(`${negative ? "-" : ""}${integerString}`);
}

function weiToEthNumber(value: bigint) {
  return Number(formatEther(value));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Postgres read timed out")), timeoutMs))
  ]);
}

function toStatus(value: string): DeployedLaunch["status"] {
  if (value === "graduated") return "Graduated";
  if (value === "ready") return "Ready";
  return "Live";
}

function trimEth(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  if (whole === "0" && !trimmed && fraction.replace(/0/g, "")) return "<0.0001";
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function formatAge(createdAt: number) {
  if (!createdAt) return "live";
  const seconds = Math.max(1, Math.floor(Date.now() / 1000) - createdAt);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function getSupabase() {
  supabase ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as never }
  });
  return supabase;
}

function dbContext(chainId: number) {
  const config = contractsForChain(chainId);
  const deploymentContexts = indexerScopesForChain(config.chain.id);
  return {
    chainId: config.chain.id,
    scopes: deploymentContexts.map((context) => context.scope),
    deploymentBlock: deploymentContexts.reduce(
      (minimum, context) => context.deployment.deploymentBlock < minimum
        ? context.deployment.deploymentBlock
        : minimum,
      deploymentContexts[0]!.deployment.deploymentBlock
    ).toString()
  };
}

function dbContextForLaunch(chainId: number, launchId: string, launchScope?: string) {
  const config = contractsForChain(chainId);
  const scope = launchScope || indexerScopeForLaunch(config.chain.id, launchId);
  const deployment = indexerScopesForChain(config.chain.id).find((context) => context.scope === scope)?.deployment;
  return {
    chainId: config.chain.id,
    scope,
    deploymentBlock: (deployment?.deploymentBlock ?? config.addresses.deploymentBlock).toString()
  };
}
