import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { formatEther, getAddress } from "viem";
import WebSocket from "ws";
import { addresses, chain } from "@/lib/contracts";
import type { DeployedLaunch, DeployedTrade } from "@/lib/onchain-launches";
import { readTokenMetadata } from "@/lib/token-metadata";

let pool: pg.Pool | undefined;
let supabase: SupabaseClient | undefined;

export async function getDbLaunches(): Promise<DeployedLaunch[] | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;

  try {
    if (hasSupabaseConfig()) {
      const { data, error } = await getSupabase()
        .from("launches")
        .select("id, token, creator, name, symbol, contract_uri, status, raised_eth, graduation_target_eth, progress, volume_eth, token_created_at, created_block")
        .eq("scope", indexerScope())
        .gte("created_block", addresses.deploymentBlock.toString())
        .order("id", { ascending: false });

      if (error) throw error;
      return mapRows(data ?? []);
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
      idleTimeoutMillis: 1_000,
      max: 2
    });
    const result = await withTimeout(pool.query(
      `select id, token, creator, name, symbol, contract_uri, status, raised_eth,
              graduation_target_eth, progress, volume_eth, token_created_at
       from launches
       where scope = $1
         and created_block >= $2
       order by id desc`
    , [indexerScope(), addresses.deploymentBlock.toString()]), 300);

    return mapRows(result.rows);
  } catch (error) {
    console.error("Failed to read launches from database", error);
    return undefined;
  }
}

export async function getDbTrades(launchId: string): Promise<DeployedTrade[] | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;

  try {
    if (hasSupabaseConfig()) {
      const { data, error } = await getSupabase()
        .from("trades")
        .select("side, trader, eth_amount, token_amount, tx_hash, block_number, created_at")
        .eq("scope", indexerScope())
        .eq("launch_id", launchId)
        .gte("block_number", addresses.deploymentBlock.toString())
        .order("block_number", { ascending: true })
        .order("id", { ascending: true });

      if (error) throw error;
      return mapTrades(data ?? []);
    }

    if (!process.env.DATABASE_URL) return undefined;
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
      idleTimeoutMillis: 1_000,
      max: 2
    });
    const result = await withTimeout(pool.query(
      `select side, trader, eth_amount, token_amount, tx_hash, block_number, created_at
       from trades
       where scope = $1
         and launch_id = $2
         and block_number >= $3
       order by block_number asc, id asc`,
      [indexerScope(), launchId, addresses.deploymentBlock.toString()]
    ), 300);

    return mapTrades(result.rows);
  } catch (error) {
    console.error("Failed to read trades from database", error);
    return undefined;
  }
}

async function mapRows(rows: Array<Record<string, unknown>>): Promise<DeployedLaunch[]> {
  return Promise.all(rows.map(async (row) => {
    const status = toStatus(String(row.status));
    const raised = parseDbBigInt(row.raised_eth);
    const target = parseDbBigInt(row.graduation_target_eth);
    const volume = parseDbBigInt(row.volume_eth);
    const contractURI = String(row.contract_uri || "");
    const metadata = await readTokenMetadata(contractURI);

    return {
      id: String(row.id),
      token: getAddress(String(row.token)) as `0x${string}`,
      creator: getAddress(String(row.creator)) as `0x${string}`,
      name: String(row.name),
      symbol: String(row.symbol),
      contractURI,
      imageURI: metadata.imageURI,
      status,
      raised: `${trimEth(formatEther(raised))} ETH`,
      target: `${trimEth(formatEther(target))} ETH`,
      progress: Number(row.progress || 0),
      holders: "indexed",
      volume: `${trimEth(formatEther(volume))} ETH`,
      age: formatAge(Number(row.token_created_at || 0)),
      risk: status === "Graduated" ? "Adminless" : "B20 gated",
      price: "Live",
      marketCap: "Live"
    };
  }));
}

function mapTrades(rows: Array<Record<string, unknown>>): DeployedTrade[] {
  return rows.map((row) => ({
    side: row.side === "sell" ? "sell" : "buy",
    trader: row.trader ? getAddress(String(row.trader)) as `0x${string}` : undefined,
    ethAmount: `${trimEth(formatEther(parseDbBigInt(row.eth_amount)))} ETH`,
    tokenAmount: trimEth(formatEther(parseDbBigInt(row.token_amount))),
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

function indexerScope() {
  const configured = process.env.NEXT_PUBLIC_INDEXER_SCOPE;
  if (configured) return configured;
  return `${chain.id}:${addresses.launchFactory?.toLowerCase()}:${addresses.bondingCurveMarket?.toLowerCase()}:${addresses.deploymentBlock.toString()}`;
}
