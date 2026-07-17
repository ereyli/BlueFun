import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import WebSocket from "ws";
import { createPublicClient, decodeEventLog, fallback, getAddress, http } from "viem";
import { chainDefinition, chainId, defaultRpcUrls } from "./deployment.js";

const vault = (process.env.BLUE_STAKING_VAULT || "0x221a86096a334bcafd5e561564dc8e6a48f19584") as `0x${string}`;
const revenueRouter = (process.env.BLUE_REVENUE_ROUTER || "0x18eda8de1afd6b6329baf742a9eb73f93ec6b741") as `0x${string}`;
export const stakingStartBlock = BigInt(process.env.BLUE_STAKING_DEPLOYMENT_BLOCK || "48678791");

const rpcUrls = Array.from(new Set([
  ...splitRpcUrls(process.env.RPC_URL || process.env.BASE_RPC_URL),
  ...splitRpcUrls(process.env.RPC_FALLBACK_URLS || process.env.BASE_RPC_FALLBACK_URLS),
  ...defaultRpcUrls
]));
const client = createPublicClient({
  chain: chainDefinition,
  transport: fallback(rpcUrls.map((url) => http(url)), { rank: true, retryCount: 1 })
});
let pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
let supabase: SupabaseClient | undefined;

const vaultAbi = [
  { type: "event", name: "Staked", inputs: [{ indexed: true, name: "account", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] },
  { type: "event", name: "RewardsFunded", inputs: [{ indexed: true, name: "distributor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }, { indexed: false, name: "rewardRate", type: "uint256" }, { indexed: false, name: "periodFinish", type: "uint256" }] },
  { type: "event", name: "RewardPaid", inputs: [{ indexed: true, name: "account", type: "address" }, { indexed: true, name: "recipient", type: "address" }, { indexed: false, name: "amount", type: "uint256" }] },
  { type: "function", name: "activeBalanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "coolingBalanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "cooldownEnd", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "earned", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalActiveStake", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalCoolingStake", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "accountedRewardBalance", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "queuedRewards", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "rewardRate", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "rewardsDuration", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "periodFinish", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "remainingScheduledRewards", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "stakingIsPaused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "emergencyExitEnabled", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] }
] as const;
const routerAbi = [{ type: "function", name: "stakingShareBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] }] as const;

type StakingEvent = {
  eventType: "staked" | "rewards_funded" | "reward_paid";
  account?: string;
  recipient?: string;
  amount: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
};

export async function updateStakingSnapshot(latest: bigint) {
  if (chainId !== 8453 || latest < stakingStartBlock) return;
  const stateKey = `staking:${chainId}:${vault.toLowerCase()}:last_block`;
  let fromBlock = (await getState(stateKey)) ?? stakingStartBlock;
  if (fromBlock < stakingStartBlock) fromBlock = stakingStartBlock;
  const configuredChunk = BigInt(process.env.STAKING_LOG_CHUNK_SIZE || "900");
  const chunkSize = configuredChunk < 1n ? 900n : configuredChunk > 1_000n ? 1_000n : configuredChunk;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize - 1n > latest ? latest : fromBlock + chunkSize - 1n;
    const logs = await client.getLogs({ address: vault, fromBlock, toBlock });
    const events: StakingEvent[] = [];
    for (const log of logs) {
      if (log.transactionHash == null || log.blockNumber == null || log.logIndex == null) continue;
      try {
        const decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
        const args = decoded.args as Record<string, unknown>;
        if (decoded.eventName === "Staked") events.push({ eventType: "staked", account: String(args.account), amount: BigInt(String(args.amount)), txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber });
        if (decoded.eventName === "RewardsFunded") events.push({ eventType: "rewards_funded", amount: BigInt(String(args.amount)), txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber });
        if (decoded.eventName === "RewardPaid") events.push({ eventType: "reward_paid", account: String(args.account), recipient: String(args.recipient), amount: BigInt(String(args.amount)), txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber });
      } catch {
        // Ignore unrelated vault events.
      }
    }
    await insertEvents(events);
    await setState(stateKey, toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
  await refreshSnapshot(latest);
}

async function refreshSnapshot(indexedBlock: bigint) {
  const summary = await getEventSummary();
  const accounts: `0x${string}`[] = summary.accounts.flatMap((value) => {
    try { return [getAddress(value)]; } catch { return []; }
  });
  const [poolState, stakingShareBps, positions] = await Promise.all([
    client.multicall({ contracts: [
      { address: vault, abi: vaultAbi, functionName: "totalActiveStake" },
      { address: vault, abi: vaultAbi, functionName: "totalCoolingStake" },
      { address: vault, abi: vaultAbi, functionName: "accountedRewardBalance" },
      { address: vault, abi: vaultAbi, functionName: "queuedRewards" },
      { address: vault, abi: vaultAbi, functionName: "rewardRate" },
      { address: vault, abi: vaultAbi, functionName: "rewardsDuration" },
      { address: vault, abi: vaultAbi, functionName: "periodFinish" },
      { address: vault, abi: vaultAbi, functionName: "remainingScheduledRewards" },
      { address: vault, abi: vaultAbi, functionName: "stakingIsPaused" },
      { address: vault, abi: vaultAbi, functionName: "emergencyExitEnabled" }
    ], allowFailure: false }),
    client.readContract({ address: revenueRouter, abi: routerAbi, functionName: "stakingShareBps" }),
    accounts.length ? client.multicall({ contracts: accounts.flatMap((account) => [
      { address: vault, abi: vaultAbi, functionName: "activeBalanceOf" as const, args: [account] },
      { address: vault, abi: vaultAbi, functionName: "coolingBalanceOf" as const, args: [account] },
      { address: vault, abi: vaultAbi, functionName: "cooldownEnd" as const, args: [account] },
      { address: vault, abi: vaultAbi, functionName: "earned" as const, args: [account] }
    ]), allowFailure: false }) : Promise.resolve([])
  ]);
  const [totalActive, totalCooling, rewardBalance, queuedRewards, rewardRate, rewardsDuration, periodFinish, remainingRewards, paused, emergency] = poolState;
  const stakers = accounts.map((account, index) => {
    const offset = index * 4;
    const active = positions[offset] as bigint;
    const cooling = positions[offset + 1] as bigint;
    const cooldownEnd = positions[offset + 2] as bigint;
    const earned = positions[offset + 3] as bigint;
    return { address: account, activeRaw: active.toString(), coolingRaw: cooling.toString(), earnedRaw: earned.toString(), cooldownEnd: Number(cooldownEnd), shareBps: totalActive === 0n ? 0 : Number((active * 10_000n) / totalActive), projectedRemainingRaw: (totalActive === 0n ? 0n : remainingRewards * active / totalActive).toString() };
  }).filter((position) => BigInt(position.activeRaw) > 0n || BigInt(position.coolingRaw) > 0n)
    .sort((a, b) => BigInt(a.activeRaw) === BigInt(b.activeRaw) ? 0 : BigInt(a.activeRaw) > BigInt(b.activeRaw) ? -1 : 1);
  await saveSnapshot({ indexedBlock, totalActive, totalCooling, rewardBalance, queuedRewards, remainingRewards, rewardRate, rewardsDuration, periodFinish, stakingShareBps: Number(stakingShareBps), lifetimeFunded: summary.lifetimeFunded, lifetimeClaimed: summary.lifetimeClaimed, uniqueStakers: accounts.length, activeStakers: stakers.filter((position) => BigInt(position.activeRaw) > 0n).length, paused, emergency, stakers });
}

async function insertEvents(events: StakingEvent[]) {
  if (!events.length) return;
  const rows = events.map((event) => ({ chain_id: chainId, vault: vault.toLowerCase(), event_type: event.eventType, account: event.account?.toLowerCase() || null, recipient: event.recipient?.toLowerCase() || null, amount: event.amount.toString(), tx_hash: event.txHash.toLowerCase(), log_index: event.logIndex, block_number: event.blockNumber.toString() }));
  if (hasSupabase()) {
    const { error } = await getSupabase().from("staking_events").upsert(rows, { onConflict: "chain_id,vault,tx_hash,log_index", ignoreDuplicates: true });
    if (error) throw error;
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  for (const row of rows) await pool.query(`insert into staking_events (chain_id,vault,event_type,account,recipient,amount,tx_hash,log_index,block_number) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`, [row.chain_id,row.vault,row.event_type,row.account,row.recipient,row.amount,row.tx_hash,row.log_index,row.block_number]);
}

async function getEventSummary(): Promise<{ lifetimeFunded: bigint; lifetimeClaimed: bigint; accounts: string[] }> {
  if (hasSupabase()) {
    const { data, error } = await getSupabase().rpc("get_staking_event_summary", { p_chain_id: chainId, p_vault: vault.toLowerCase() });
    if (error) throw error;
    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    return { lifetimeFunded: BigInt(String(row?.lifetime_funded || "0")), lifetimeClaimed: BigInt(String(row?.lifetime_claimed || "0")), accounts: Array.isArray(row?.accounts) ? row.accounts.map(String) : [] };
  }
  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query(`select coalesce(sum(amount) filter (where event_type='rewards_funded'),0) lifetime_funded, coalesce(sum(amount) filter (where event_type='reward_paid'),0) lifetime_claimed, coalesce(array_agg(distinct lower(account)) filter (where event_type='staked' and account is not null),array[]::text[]) accounts from staking_events where chain_id=$1 and vault=$2`, [chainId, vault.toLowerCase()]);
  return { lifetimeFunded: BigInt(result.rows[0].lifetime_funded), lifetimeClaimed: BigInt(result.rows[0].lifetime_claimed), accounts: (result.rows[0].accounts || []).map(String) };
}

async function saveSnapshot(input: Record<string, unknown> & { stakers: unknown[] }) {
  const row = { chain_id: chainId, vault: vault.toLowerCase(), indexed_block: String(input.indexedBlock), total_active: String(input.totalActive), total_cooling: String(input.totalCooling), reward_balance: String(input.rewardBalance), queued_rewards: String(input.queuedRewards), remaining_rewards: String(input.remainingRewards), reward_rate: String(input.rewardRate), rewards_duration: String(input.rewardsDuration), period_finish: String(input.periodFinish), staking_share_bps: input.stakingShareBps, lifetime_funded: String(input.lifetimeFunded), lifetime_claimed: String(input.lifetimeClaimed), unique_stakers: input.uniqueStakers, active_stakers: input.activeStakers, paused: input.paused, emergency: input.emergency, stakers: input.stakers, updated_at: new Date().toISOString() };
  if (hasSupabase()) {
    const { error } = await getSupabase().from("staking_snapshots").upsert(row, { onConflict: "chain_id,vault" });
    if (error) throw error;
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query(`insert into staking_snapshots (chain_id,vault,indexed_block,total_active,total_cooling,reward_balance,queued_rewards,remaining_rewards,reward_rate,rewards_duration,period_finish,staking_share_bps,lifetime_funded,lifetime_claimed,unique_stakers,active_stakers,paused,emergency,stakers,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now()) on conflict (chain_id,vault) do update set indexed_block=excluded.indexed_block,total_active=excluded.total_active,total_cooling=excluded.total_cooling,reward_balance=excluded.reward_balance,queued_rewards=excluded.queued_rewards,remaining_rewards=excluded.remaining_rewards,reward_rate=excluded.reward_rate,rewards_duration=excluded.rewards_duration,period_finish=excluded.period_finish,staking_share_bps=excluded.staking_share_bps,lifetime_funded=excluded.lifetime_funded,lifetime_claimed=excluded.lifetime_claimed,unique_stakers=excluded.unique_stakers,active_stakers=excluded.active_stakers,paused=excluded.paused,emergency=excluded.emergency,stakers=excluded.stakers,updated_at=now()`, [row.chain_id,row.vault,row.indexed_block,row.total_active,row.total_cooling,row.reward_balance,row.queued_rewards,row.remaining_rewards,row.reward_rate,row.rewards_duration,row.period_finish,row.staking_share_bps,row.lifetime_funded,row.lifetime_claimed,row.unique_stakers,row.active_stakers,row.paused,row.emergency,JSON.stringify(row.stakers)]);
}

async function getState(key: string) {
  if (hasSupabase()) {
    const { data, error } = await getSupabase().from("indexer_state").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.value ? BigInt(data.value) : undefined;
  }
  if (!pool) throw new Error("Database client is not configured");
  const result = await pool.query("select value from indexer_state where key=$1", [key]);
  return result.rowCount ? BigInt(result.rows[0].value) : undefined;
}

async function setState(key: string, value: bigint) {
  if (hasSupabase()) {
    const { error } = await getSupabase().from("indexer_state").upsert({ key, value: value.toString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
    return;
  }
  if (!pool) throw new Error("Database client is not configured");
  await pool.query("insert into indexer_state(key,value,updated_at) values($1,$2,now()) on conflict(key) do update set value=excluded.value,updated_at=now()", [key, value.toString()]);
}

function hasSupabase() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
function getSupabase() {
  supabase ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, realtime: { transport: WebSocket as never } });
  return supabase;
}
function splitRpcUrls(value?: string) { return (value || "").split(",").map((url) => url.trim()).filter(Boolean); }
