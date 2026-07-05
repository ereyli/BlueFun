import "dotenv/config";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { graduationAbi, launchFactoryAbi, marketAbi } from "./abi.js";
import {
  ensureSchema,
  getIndexerState,
  insertTrade,
  markGraduated,
  setIndexerState,
  updateLaunchState,
  upsertLaunch
} from "./db.js";

const rpcUrl = process.env.BASE_RPC_URL || "https://sepolia.base.org";
const launchFactory = process.env.LAUNCH_FACTORY as `0x${string}` | undefined;
const market = process.env.BONDING_CURVE_MARKET as `0x${string}` | undefined;
const graduationManager = process.env.GRADUATION_MANAGER as `0x${string}` | undefined;
const startBlock = BigInt(process.env.START_BLOCK || process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK || "43545419");
const chunkSize = BigInt(process.env.LOG_CHUNK_SIZE || "1900");
const pollMs = Number(process.env.POLL_MS || "30000");
const confirmations = BigInt(process.env.CONFIRMATIONS || "3");
let isPolling = false;
let nextPollDelayMs = pollMs;

if (!launchFactory || !market || !graduationManager) {
  throw new Error("Set LAUNCH_FACTORY, BONDING_CURVE_MARKET and GRADUATION_MANAGER");
}

const launchFactoryAddress = launchFactory;
const marketAddress = market;
const graduationManagerAddress = graduationManager;
const stateScope = `${launchFactoryAddress.toLowerCase()}:${marketAddress.toLowerCase()}:${startBlock.toString()}`;
process.env.INDEXER_SCOPE ||= `${baseSepolia.id}:${stateScope}`;

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl)
});

await ensureSchema();
console.log("BlueFun indexer starting", {
  launchFactory: launchFactoryAddress,
  market: marketAddress,
  graduationManager: graduationManagerAddress,
  startBlock: startBlock.toString(),
  chunkSize: chunkSize.toString(),
  confirmations: confirmations.toString(),
  scope: process.env.INDEXER_SCOPE
});

await runIndexerPoll();
scheduleNextPoll();

function scheduleNextPoll() {
  setTimeout(async () => {
    await runIndexerPoll();
    scheduleNextPoll();
  }, nextPollDelayMs);
}

async function runIndexerPoll() {
  if (isPolling) return;
  isPolling = true;
  try {
    await backfillLoop();
    nextPollDelayMs = pollMs;
  } catch (error) {
    const rateLimited = isRateLimitError(error);
    nextPollDelayMs = rateLimited
      ? Math.min(Math.max(nextPollDelayMs * 2, 60_000), 300_000)
      : pollMs;
    console.error(rateLimited ? "Indexer RPC rate limited; backing off" : "Indexer poll failed", error);
  } finally {
    isPolling = false;
  }
}

async function backfillLoop() {
  const head = await client.getBlockNumber();
  if (head <= confirmations) return;
  const latest = head - confirmations;
  if (latest < startBlock) return;
  await backfillLaunchCreated(latest);
  await backfillMarketBuys(latest);
  await backfillMarketSells(latest);
  await backfillGraduations(latest);
}

async function backfillLaunchCreated(latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey("launch_factory_last_block"))) ?? startBlock;
  if (fromBlock < startBlock) fromBlock = startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: launchFactoryAddress,
      abi: launchFactoryAbi,
      eventName: "LaunchCreated",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleLaunchCreated(log);
    }

    await setIndexerState(stateKey("launch_factory_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillMarketBuys(latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey("market_buys_last_block"))) ?? startBlock;
  if (fromBlock < startBlock) fromBlock = startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: marketAddress,
      abi: marketAbi,
      eventName: "TokensBought",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleTokensBought(log);
    }

    await setIndexerState(stateKey("market_buys_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillMarketSells(latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey("market_sells_last_block"))) ?? startBlock;
  if (fromBlock < startBlock) fromBlock = startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: marketAddress,
      abi: marketAbi,
      eventName: "TokensSold",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleTokensSold(log);
    }

    await setIndexerState(stateKey("market_sells_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillGraduations(latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey("graduations_last_block"))) ?? startBlock;
  if (fromBlock < startBlock) fromBlock = startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: graduationManagerAddress,
      abi: graduationAbi,
      eventName: "Graduated",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleGraduated(log);
    }

    await setIndexerState(stateKey("graduations_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

function stateKey(key: string) {
  return `${process.env.INDEXER_SCOPE || stateScope}:${key}`;
}

async function handleLaunchCreated(log: Awaited<ReturnType<typeof client.getContractEvents<typeof launchFactoryAbi, "LaunchCreated">>>[number]) {
  await upsertLaunch({
    id: log.args.launchId!,
    token: log.args.token!,
    creator: log.args.creator!,
    name: log.args.name!,
    symbol: log.args.symbol!,
    contractURI: log.args.contractURI!,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(log.args.launchId!);
}

async function handleTokensBought(log: Awaited<ReturnType<typeof client.getContractEvents<typeof marketAbi, "TokensBought">>>[number]) {
  await insertTrade({
    launchId: log.args.launchId!,
    trader: log.args.buyer!,
    side: "buy",
    ethAmount: log.args.ethIn!,
    tokenAmount: log.args.tokensOut!,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(log.args.launchId!);
}

async function handleTokensSold(log: Awaited<ReturnType<typeof client.getContractEvents<typeof marketAbi, "TokensSold">>>[number]) {
  await insertTrade({
    launchId: log.args.launchId!,
    trader: log.args.seller!,
    side: "sell",
    ethAmount: log.args.ethOut!,
    tokenAmount: log.args.tokensIn!,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(log.args.launchId!);
}

async function handleGraduated(log: Awaited<ReturnType<typeof client.getContractEvents<typeof graduationAbi, "Graduated">>>[number]) {
  await markGraduated({
    launchId: log.args.launchId!,
    token: log.args.token!,
    positionId: log.args.positionId!,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(log.args.launchId!);
}

async function refreshLaunchState(launchId: bigint) {
  const state = await client.readContract({
    address: marketAddress,
    abi: marketAbi,
    functionName: "launches",
    args: [launchId]
  });

  const realEthReserve = state[4];
  const graduationEthTarget = state[5];
  const progress = graduationEthTarget === 0n ? 0 : Number((realEthReserve * 100n) / graduationEthTarget);
  const status = state[15] ? "graduated" : state[14] ? "ready" : "live";

  await updateLaunchState({
    id: launchId,
    status,
    raisedEth: realEthReserve,
    graduationTargetEth: graduationEthTarget,
    progress: Math.min(progress, 100),
    volumeEth: realEthReserve,
    creatorAllocation: state[8],
    tokenCreatedAt: state[11]
  });
}

function isRateLimitError(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return text.toLowerCase().includes("rate limit") || text.toLowerCase().includes("over rate limit");
}
