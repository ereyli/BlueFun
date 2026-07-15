import "dotenv/config";
import { createServer } from "node:http";
import { createPublicClient, encodeAbiParameters, fallback, getAddress, http, keccak256, zeroAddress } from "viem";
import { directLaunchFactoryAbi, graduationAbi, launchFactoryAbi, marketAbi, poolManagerAbi } from "./abi.js";
import {
  chainDefinition,
  chainId,
  defaultRpcUrls,
  directDeployments,
  deployments,
  poolManager,
  scopeForDeployment,
  type IndexerDeployment
} from "./deployment.js";
import {
  ensureSchema,
  closeDatabase,
  getGraduatedLaunches,
  getIndexerState,
  insertTrade,
  markGraduated,
  setIndexerState,
  updateLaunchState,
  upsertLaunch
} from "./db.js";
import { mirrorTokenImage } from "./token-image-cdn.js";

const rpcUrls = uniqueUrls([
  ...splitRpcUrls(process.env.RPC_URL || process.env.BASE_RPC_URL),
  ...splitRpcUrls(process.env.RPC_FALLBACK_URLS || process.env.BASE_RPC_FALLBACK_URLS),
  ...defaultRpcUrls
]);
type DeploymentContext = IndexerDeployment & { scope: string };
type ScopeContext = { scope: string; startBlock: bigint };
const deploymentContexts: DeploymentContext[] = deployments.map((deployment) => ({
  ...deployment,
  scope: scopeForDeployment(deployment)
}));
const v4TickSpacing = 60;
const vNextBaseHook = "0xf0b8dde19510ee7d6d50be289c4257ecd14c60cc" as const;
const chunkSize = BigInt(process.env.LOG_CHUNK_SIZE || "1900");
const pollMs = Number(process.env.POLL_MS || (chainId === 8453 ? "5000" : "12000"));
const confirmations = BigInt(process.env.CONFIRMATIONS || (chainId === 8453 ? "2" : "3"));
const totalSupplyRaw = 1_000_000_000n * 10n ** 18n;
const q192 = 1n << 192n;
let isPolling = false;
let nextPollDelayMs = pollMs;
let lastSuccessfulPollAt = 0;
let lastIndexedBlock = 0n;
let lastPollError = "";
let stopped = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
const startedAt = Date.now();
const healthPort = Number(process.env.HEALTH_PORT || "3000");

if (deploymentContexts.length === 0) throw new Error("At least one deployment must be configured");

type LaunchMetadata = {
  image?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
};

const client = createPublicClient({
  chain: chainDefinition,
  transport: fallback(rpcUrls.map((url) => http(url)), { rank: true, retryCount: 1 })
});

await ensureSchema();
const healthServer = createServer((request, response) => {
  const ageMs = lastSuccessfulPollAt ? Date.now() - lastSuccessfulPollAt : Date.now() - startedAt;
  const healthy = lastSuccessfulPollAt > 0
    ? ageMs <= Math.max(pollMs * 5, 180_000)
    : ageMs <= 600_000;
  const payload = JSON.stringify({
    status: healthy ? lastSuccessfulPollAt ? "ok" : "starting" : "stale",
    chainId,
    scopes: [...deploymentContexts.map((deployment) => deployment.scope), ...directDeployments.map((deployment) => deployment.scope)],
    isPolling,
    lastIndexedBlock: lastIndexedBlock.toString(),
    lastSuccessfulPollAt: lastSuccessfulPollAt ? new Date(lastSuccessfulPollAt).toISOString() : null,
    lastError: lastPollError || null
  });
  response.writeHead(request.url === "/health" && healthy ? 200 : request.url === "/health" ? 503 : 200, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  response.end(payload);
});
healthServer.listen(healthPort, "0.0.0.0", () => console.log("Indexer health server listening", { healthPort }));
console.log("BlueFun indexer starting", {
  deployments: deploymentContexts.map((deployment) => ({
    version: deployment.version,
    launchFactory: deployment.launchFactory,
    market: deployment.bondingCurveMarket,
    graduationManager: deployment.graduationManager,
    startBlock: deployment.startBlock.toString(),
    scope: deployment.scope
  })),
  chunkSize: chunkSize.toString(),
  confirmations: confirmations.toString(),
  rpcEndpoints: rpcUrls.length.toString(),
  scopes: deploymentContexts.length
});

await runIndexerPoll();
scheduleNextPoll();

function scheduleNextPoll() {
  if (stopped) return;
  pollTimer = setTimeout(async () => {
    await runIndexerPoll();
    scheduleNextPoll();
  }, nextPollDelayMs);
}

function splitRpcUrls(value?: string) {
  return (value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls));
}

async function runIndexerPoll() {
  if (isPolling) return;
  isPolling = true;
  try {
    await backfillLoop();
    lastSuccessfulPollAt = Date.now();
    lastPollError = "";
    nextPollDelayMs = pollMs;
  } catch (error) {
    lastPollError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
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
  lastIndexedBlock = latest;
  for (const deployment of deploymentContexts) {
    if (latest < deployment.startBlock) continue;
    await backfillLaunchCreated(deployment, latest);
    await backfillMarketBuys(deployment, latest);
    await backfillMarketSells(deployment, latest);
    await backfillGraduations(deployment, latest);
    await backfillUniswapV4Swaps(deployment, latest);
  }
  for (const directDeployment of directDeployments) {
    if (latest < directDeployment.startBlock) continue;
    await backfillDirectLaunches(directDeployment, latest);
    await backfillUniswapV4Swaps(directDeployment, latest);
  }
}

async function shutdown(signal: string) {
  if (stopped) return;
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
  console.log("Indexer shutting down", { signal });
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await closeDatabase();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

async function backfillLaunchCreated(deployment: DeploymentContext, latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey(deployment, "launch_factory_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: deployment.launchFactory,
      abi: launchFactoryAbi,
      eventName: "LaunchCreated",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleLaunchCreated(deployment, log);
    }

    await setIndexerState(stateKey(deployment, "launch_factory_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillDirectLaunches(
  deployment: ScopeContext & { launchFactory: `0x${string}`; liquidityLocker: `0x${string}` },
  latest: bigint
) {
  let fromBlock = (await getIndexerState(stateKey(deployment, "direct_launches_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: deployment.launchFactory,
      abi: directLaunchFactoryAbi,
      eventName: "DirectLaunchCreated",
      fromBlock,
      toBlock
    });
    for (const log of logs) await handleDirectLaunchCreated(deployment, log);
    await setIndexerState(stateKey(deployment, "direct_launches_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillMarketBuys(deployment: DeploymentContext, latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey(deployment, "market_buys_v2_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: deployment.bondingCurveMarket,
      abi: marketAbi,
      eventName: "TokensBought",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleTokensBought(deployment, log);
    }

    await setIndexerState(stateKey(deployment, "market_buys_v2_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillMarketSells(deployment: DeploymentContext, latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey(deployment, "market_sells_v2_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: deployment.bondingCurveMarket,
      abi: marketAbi,
      eventName: "TokensSold",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleTokensSold(deployment, log);
    }

    await setIndexerState(stateKey(deployment, "market_sells_v2_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillGraduations(deployment: DeploymentContext, latest: bigint) {
  let fromBlock = (await getIndexerState(stateKey(deployment, "graduations_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: deployment.graduationManager,
      abi: graduationAbi,
      eventName: "Graduated",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      await handleGraduated(deployment, log);
    }

    await setIndexerState(stateKey(deployment, "graduations_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

async function backfillUniswapV4Swaps(deployment: ScopeContext, latest: bigint) {
  const graduated = await getGraduatedLaunches(deployment.scope);
  if (graduated.length === 0) return;

  const poolMap = new Map<string, { launchId: bigint; token: `0x${string}` }>();
  let firstGraduationBlock = latest;
  for (const launch of graduated) {
    const token = getAddress(launch.token) as `0x${string}`;
    poolMap.set((launch.poolId || blueFunV4PoolId(token, deployment)).toLowerCase(), { launchId: launch.launchId, token });
    if (launch.blockNumber && launch.blockNumber < firstGraduationBlock) firstGraduationBlock = launch.blockNumber;
  }

  let fromBlock =
    (await getIndexerState(stateKey(deployment, "uniswap_v4_swaps_v3_last_block"))) ?? firstGraduationBlock;
  if (fromBlock < firstGraduationBlock) fromBlock = firstGraduationBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: poolManager,
      abi: poolManagerAbi,
      eventName: "Swap",
      args: { id: Array.from(poolMap.keys()) as `0x${string}`[] },
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      const pool = poolMap.get(String(log.args.id).toLowerCase());
      if (!pool) continue;
      await handleUniswapV4Swap(deployment, log, pool.launchId);
    }

    await setIndexerState(stateKey(deployment, "uniswap_v4_swaps_v3_last_block"), toBlock + 1n);
    fromBlock = toBlock + 1n;
  }
}

function stateKey(deployment: ScopeContext, key: string) {
  return `${deployment.scope}:${key}`;
}

async function handleLaunchCreated(
  deployment: DeploymentContext,
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof launchFactoryAbi, "LaunchCreated">>>[number]
) {
  const metadata: LaunchMetadata = await readLaunchMetadata(log.args.contractURI || "").catch(() => ({}));
  const cdnImage = metadata.image
    ? await mirrorTokenImage(metadata.image, chainId, log.args.token!).catch((error) => {
      console.warn("Token image CDN mirror failed", { token: log.args.token, error });
      return undefined;
    })
    : undefined;
  await upsertLaunch(deployment.scope, {
    id: log.args.launchId!,
    token: log.args.token!,
    creator: log.args.creator!,
    name: log.args.name!,
    symbol: log.args.symbol!,
    contractURI: log.args.contractURI!,
    imageUri: cdnImage || metadata.image,
    description: metadata.description,
    website: metadata.website,
    twitter: metadata.twitter,
    telegram: metadata.telegram,
    discord: metadata.discord,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(deployment, log.args.launchId!);
}

async function handleDirectLaunchCreated(
  deployment: ScopeContext & { liquidityLocker: `0x${string}` },
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof directLaunchFactoryAbi, "DirectLaunchCreated">>>[number]
) {
  const metadata: LaunchMetadata = await readLaunchMetadata(log.args.contractURI || "").catch(() => ({}));
  const cdnImage = metadata.image
    ? await mirrorTokenImage(metadata.image, chainId, log.args.token!).catch(() => undefined)
    : undefined;
  await upsertLaunch(deployment.scope, {
    id: log.args.launchId!,
    token: log.args.token!,
    creator: log.args.creator!,
    name: log.args.name!,
    symbol: log.args.symbol!,
    contractURI: log.args.contractURI!,
    imageUri: cdnImage || metadata.image,
    description: metadata.description,
    website: metadata.website,
    twitter: metadata.twitter,
    telegram: metadata.telegram,
    discord: metadata.discord,
    launchMode: "direct",
    poolFee: Number(log.args.poolFee!),
    tickSpacing: Number(log.args.tickSpacing!),
    liquidityLocker: deployment.liquidityLocker,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await markGraduated(deployment.scope, {
    launchId: log.args.launchId!,
    token: log.args.token!,
    positionId: log.args.positionId!,
    poolId: log.args.poolId!,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  const block = await client.getBlock({ blockNumber: log.blockNumber });
  await updateLaunchState(deployment.scope, {
    id: log.args.launchId!,
    status: "graduated",
    raisedEth: 0n,
    graduationTargetEth: 0n,
    progress: 100,
    creatorAllocation: 0n,
    tokenCreatedAt: block.timestamp
  });
}

async function readLaunchMetadata(contractURI: string): Promise<LaunchMetadata> {
  for (const url of ipfsToGatewayUrls(contractURI)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const metadata = await response.json() as {
        description?: unknown;
        external_url?: unknown;
        image?: unknown;
        socials?: Record<string, unknown>;
      };
      return {
        image: typeof metadata.image === "string" ? metadata.image.slice(0, 240) : undefined,
        description: cleanMetadataText(metadata.description, 500),
        website: cleanMetadataUrl(metadata.socials?.website) || cleanMetadataUrl(metadata.external_url),
        twitter: cleanMetadataUrl(metadata.socials?.twitter),
        telegram: cleanMetadataUrl(metadata.socials?.telegram),
        discord: cleanMetadataUrl(metadata.socials?.discord)
      };
    } catch {
      // Try the next gateway.
    }
  }
  return {};
}

function ipfsToGatewayUrls(uri: string) {
  if (!uri) return [];
  if (uri.startsWith("https://") || uri.startsWith("http://")) return [uri];
  if (!uri.startsWith("ipfs://")) return [];
  const cidPath = uri.replace("ipfs://", "");
  const gateway = process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
  return [
    `${gateway.replace(/\/$/, "")}/${cidPath}`,
    `https://ipfs.io/ipfs/${cidPath}`,
    `https://cloudflare-ipfs.com/ipfs/${cidPath}`
  ];
}

function cleanMetadataText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || undefined;
}

function cleanMetadataUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().slice(0, 240);
  if (!clean) return undefined;
  try {
    const url = new URL(clean);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function handleTokensBought(
  deployment: DeploymentContext,
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof marketAbi, "TokensBought">>>[number]
) {
  const marketCapEth =
    await readCurveMarketCapAtBlock(deployment, log.args.launchId!, log.blockNumber).catch(() => undefined);
  await insertTrade(deployment.scope, {
    launchId: log.args.launchId!,
    trader: log.args.buyer!,
    side: "buy",
    source: "curve",
    ethAmount: log.args.ethIn!,
    tokenAmount: log.args.tokensOut!,
    marketCapEth,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(deployment, log.args.launchId!);
}

async function handleTokensSold(
  deployment: DeploymentContext,
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof marketAbi, "TokensSold">>>[number]
) {
  const marketCapEth =
    await readCurveMarketCapAtBlock(deployment, log.args.launchId!, log.blockNumber).catch(() => undefined);
  await insertTrade(deployment.scope, {
    launchId: log.args.launchId!,
    trader: log.args.seller!,
    side: "sell",
    source: "curve",
    ethAmount: log.args.ethOut!,
    tokenAmount: log.args.tokensIn!,
    marketCapEth,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(deployment, log.args.launchId!);
}

async function handleGraduated(
  deployment: DeploymentContext,
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof graduationAbi, "Graduated">>>[number]
) {
  await markGraduated(deployment.scope, {
    launchId: log.args.launchId!,
    token: log.args.token!,
    positionId: log.args.positionId!,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
  await refreshLaunchState(deployment, log.args.launchId!);
}

async function handleUniswapV4Swap(
  deployment: ScopeContext,
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof poolManagerAbi, "Swap">>>[number],
  launchId: bigint
) {
  const amount0 = log.args.amount0!;
  const amount1 = log.args.amount1!;
  if (amount0 === 0n || amount1 === 0n) return;

  const side = amount0 < 0n ? "buy" : "sell";
  const ethAmount = absBigInt(amount0);
  const tokenAmount = absBigInt(amount1);
  const trader = await readTransactionSender(log.transactionHash).catch(() => log.args.sender!);
  const marketCapEth = marketCapWeiFromSqrtPrice(log.args.sqrtPriceX96!);

  await insertTrade(deployment.scope, {
    launchId,
    trader,
    side,
    source: "uniswap_v4",
    ethAmount,
    tokenAmount,
    marketCapEth,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
}

function blueFunV4PoolId(token: `0x${string}`, deployment: ScopeContext & { version?: IndexerDeployment["version"] }) {
  const vNext = deployment.version === "vnext";
  const encoded = encodeAbiParameters(
    [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" }
        ]
      }
    ],
    [
      {
        currency0: zeroAddress,
        currency1: token,
        fee: vNext ? 0x800000 : 3000,
        tickSpacing: v4TickSpacing,
        hooks: vNext ? vNextBaseHook : zeroAddress
      }
    ]
  );
  return keccak256(encoded).toLowerCase();
}

async function readTransactionSender(hash: `0x${string}`) {
  const transaction = await client.getTransaction({ hash });
  return transaction.from;
}

function absBigInt(value: bigint) {
  return value < 0n ? -value : value;
}

async function readCurveMarketCapAtBlock(
  deployment: DeploymentContext,
  launchId: bigint,
  blockNumber: bigint
) {
  const state = await client.readContract({
    address: deployment.bondingCurveMarket,
    abi: marketAbi,
    functionName: "launches",
    args: [launchId],
    blockNumber
  });
  return curveMarketCapWei(state[2], state[3], state[7]);
}

function curveMarketCapWei(virtualTokenReserve: bigint, virtualEthReserve: bigint, maxSupply: bigint) {
  if (virtualTokenReserve <= 0n) return 0n;
  return (virtualEthReserve * maxSupply) / virtualTokenReserve;
}

function marketCapWeiFromSqrtPrice(sqrtPriceX96: bigint) {
  if (sqrtPriceX96 <= 0n) return 0n;
  return (totalSupplyRaw * q192) / (sqrtPriceX96 * sqrtPriceX96);
}

async function refreshLaunchState(deployment: DeploymentContext, launchId: bigint) {
  const state = await client.readContract({
    address: deployment.bondingCurveMarket,
    abi: marketAbi,
    functionName: "launches",
    args: [launchId]
  });

  const grossEthRaised = state[5];
  const graduationEthTarget = state[6];
  const progress = graduationEthTarget === 0n ? 0 : Number((grossEthRaised * 100n) / graduationEthTarget);
  const status = state[16] ? "graduated" : state[15] ? "ready" : "live";

  await updateLaunchState(deployment.scope, {
    id: launchId,
    status,
    raisedEth: grossEthRaised,
    graduationTargetEth: graduationEthTarget,
    progress: Math.min(progress, 100),
    creatorAllocation: state[9],
    tokenCreatedAt: state[12]
  });
}

function isRateLimitError(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${safeJsonStringify(error)}` : String(error);
  const normalized = text.toLowerCase();
  return normalized.includes("rate limit")
    || normalized.includes("over rate limit")
    || normalized.includes("compute units")
    || normalized.includes("throughput")
    || normalized.includes("code\":429")
    || normalized.includes("code: 429");
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    );
  } catch {
    return "";
  }
}
