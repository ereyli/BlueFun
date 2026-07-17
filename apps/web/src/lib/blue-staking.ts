import { createPublicClient, fallback, formatEther, http, parseAbi, parseAbiItem } from "viem";
import { baseChain } from "@/lib/base-chain";
import { blueStakingAddresses } from "@/lib/contracts";
import { baseRpcUrls } from "@/lib/rpc";

const DEPLOYMENT_BLOCK = blueStakingAddresses.deploymentBlock;
// Base's public RPC accepts historical log scans in ranges of at most 10,000 blocks.
// Keeping every request within that shared limit also makes per-provider fallback reliable.
const LOG_CHUNK = 10_000n;

const rpcUrls = baseRpcUrls();
const client = createPublicClient({
  chain: {
    ...baseChain,
    contracts: {
      multicall3: {
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        blockCreated: 5_022
      }
    }
  },
  transport: fallback(rpcUrls.map((url) => http(url, { retryCount: 0, timeout: 8_000 })), { rank: true, retryCount: 0 })
});
const logClients = rpcUrls.map((url) => createPublicClient({
  chain: baseChain,
  transport: http(url, { retryCount: 0, timeout: 8_000 })
}));
type StakingLogClient = (typeof logClients)[number];
let preferredLogClientIndex = 0;

const stakedEvent = parseAbiItem("event Staked(address indexed account, uint256 amount)");
const rewardsFundedEvent = parseAbiItem("event RewardsFunded(address indexed distributor, uint256 amount, uint256 rewardRate, uint256 periodFinish)");
const rewardPaidEvent = parseAbiItem("event RewardPaid(address indexed account, address indexed recipient, uint256 amount)");

const vaultReadAbi = parseAbi([
  "function activeBalanceOf(address) view returns (uint256)",
  "function coolingBalanceOf(address) view returns (uint256)",
  "function cooldownEnd(address) view returns (uint64)",
  "function earned(address) view returns (uint256)",
  "function totalActiveStake() view returns (uint256)",
  "function totalCoolingStake() view returns (uint256)",
  "function accountedRewardBalance() view returns (uint256)",
  "function queuedRewards() view returns (uint256)",
  "function rewardRate() view returns (uint256)",
  "function rewardsDuration() view returns (uint64)",
  "function periodFinish() view returns (uint64)",
  "function remainingScheduledRewards() view returns (uint256)",
  "function stakingIsPaused() view returns (bool)",
  "function emergencyExitEnabled() view returns (bool)"
]);

const routerReadAbi = parseAbi(["function stakingShareBps() view returns (uint16)"]);

export type BlueStakingOverview = {
  updatedAt: string;
  indexedBlock: string;
  source: "indexer" | "rpc";
  isStale: boolean;
  totalActiveRaw: string;
  totalCoolingRaw: string;
  rewardBalanceRaw: string;
  queuedRewardsRaw: string;
  remainingRewardsRaw: string;
  rewardRateRaw: string;
  rewardsDuration: number;
  periodFinish: number;
  stakingShareBps: number;
  lifetimeFundedRaw: string;
  lifetimeClaimedRaw: string;
  uniqueStakers: number;
  activeStakers: number;
  paused: boolean;
  emergency: boolean;
  stakers: Array<{
    address: string;
    activeRaw: string;
    coolingRaw: string;
    earnedRaw: string;
    cooldownEnd: number;
    shareBps: number;
    projectedRemainingRaw: string;
  }>;
};

async function readLogsWithRpcFallback<T>(reader: (rpcClient: StakingLogClient) => Promise<T[]>) {
  let lastError: unknown;
  for (let offset = 0; offset < logClients.length; offset += 1) {
    const clientIndex = (preferredLogClientIndex + offset) % logClients.length;
    try {
      const logs = await reader(logClients[clientIndex]);
      preferredLogClientIndex = clientIndex;
      return logs;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Every Base RPC failed to return staking logs.");
}

async function getLogsInChunks<T>(
  latest: bigint,
  reader: (rpcClient: StakingLogClient, fromBlock: bigint, toBlock: bigint) => Promise<T[]>
) {
  const logs: T[] = [];
  for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= latest; fromBlock += LOG_CHUNK) {
    const toBlock = fromBlock + LOG_CHUNK - 1n > latest ? latest : fromBlock + LOG_CHUNK - 1n;
    logs.push(...await readLogsWithRpcFallback((rpcClient) => reader(rpcClient, fromBlock, toBlock)));
  }
  return logs;
}

export async function getBlueStakingOverview(): Promise<BlueStakingOverview> {
  const latest = await client.getBlockNumber();
  const [stakeLogs, fundedLogs, paidLogs, poolState, stakingShareBps] = await Promise.all([
    getLogsInChunks(latest, (rpcClient, fromBlock, toBlock) => rpcClient.getLogs({ address: blueStakingAddresses.vault, event: stakedEvent, fromBlock, toBlock })),
    getLogsInChunks(latest, (rpcClient, fromBlock, toBlock) => rpcClient.getLogs({ address: blueStakingAddresses.vault, event: rewardsFundedEvent, fromBlock, toBlock })),
    getLogsInChunks(latest, (rpcClient, fromBlock, toBlock) => rpcClient.getLogs({ address: blueStakingAddresses.vault, event: rewardPaidEvent, fromBlock, toBlock })),
    client.multicall({ contracts: [
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "totalActiveStake" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "totalCoolingStake" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "accountedRewardBalance" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "queuedRewards" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "rewardRate" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "rewardsDuration" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "periodFinish" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "remainingScheduledRewards" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "stakingIsPaused" },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "emergencyExitEnabled" }
    ], allowFailure: false }),
    client.readContract({ address: blueStakingAddresses.revenueRouter, abi: routerReadAbi, functionName: "stakingShareBps" })
  ]);

  const [totalActive, totalCooling, rewardBalance, queuedRewards, rewardRate, rewardsDuration, periodFinish, remainingRewards, paused, emergency] = poolState;
  const accounts = Array.from(new Set(stakeLogs.map((log) => log.args.account).filter(Boolean))) as `0x${string}`[];
  const positions = accounts.length ? await client.multicall({
    contracts: accounts.flatMap((account) => [
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "activeBalanceOf" as const, args: [account] },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "coolingBalanceOf" as const, args: [account] },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "cooldownEnd" as const, args: [account] },
      { address: blueStakingAddresses.vault, abi: vaultReadAbi, functionName: "earned" as const, args: [account] }
    ]),
    allowFailure: false
  }) : [];

  const stakers = accounts.map((account, index) => {
    const offset = index * 4;
    const active = positions[offset] as bigint;
    const cooling = positions[offset + 1] as bigint;
    const cooldownEnd = positions[offset + 2] as bigint;
    const earned = positions[offset + 3] as bigint;
    return {
      address: account,
      activeRaw: active.toString(),
      coolingRaw: cooling.toString(),
      earnedRaw: earned.toString(),
      cooldownEnd: Number(cooldownEnd),
      shareBps: totalActive === 0n ? 0 : Number((active * 10_000n) / totalActive),
      projectedRemainingRaw: (totalActive === 0n ? 0n : (remainingRewards * active) / totalActive).toString()
    };
  }).filter((position) => BigInt(position.activeRaw) > 0n || BigInt(position.coolingRaw) > 0n)
    .sort((a, b) => BigInt(a.activeRaw) === BigInt(b.activeRaw) ? 0 : BigInt(a.activeRaw) > BigInt(b.activeRaw) ? -1 : 1);

  const lifetimeFunded = fundedLogs.reduce((sum, log) => sum + (log.args.amount ?? 0n), 0n);
  const lifetimeClaimed = paidLogs.reduce((sum, log) => sum + (log.args.amount ?? 0n), 0n);

  return {
    updatedAt: new Date().toISOString(),
    indexedBlock: latest.toString(),
    source: "rpc",
    isStale: false,
    totalActiveRaw: totalActive.toString(),
    totalCoolingRaw: totalCooling.toString(),
    rewardBalanceRaw: rewardBalance.toString(),
    queuedRewardsRaw: queuedRewards.toString(),
    remainingRewardsRaw: remainingRewards.toString(),
    rewardRateRaw: rewardRate.toString(),
    rewardsDuration: Number(rewardsDuration),
    periodFinish: Number(periodFinish),
    stakingShareBps: Number(stakingShareBps),
    lifetimeFundedRaw: lifetimeFunded.toString(),
    lifetimeClaimedRaw: lifetimeClaimed.toString(),
    uniqueStakers: accounts.length,
    activeStakers: stakers.filter((position) => BigInt(position.activeRaw) > 0n).length,
    paused,
    emergency,
    stakers
  };
}

export function formatStakingValue(raw: string) {
  return formatEther(BigInt(raw));
}
