import "dotenv/config";
import { createServer } from "node:http";
import { createPublicClient, encodeAbiParameters, fallback, getAddress, http, keccak256, zeroAddress } from "viem";
import {
  blueEdition1155Abi,
  bluePFP721Abi,
  arcDirectLaunchFactoryAbi,
  directLaunchFactoryAbi,
  ekuboDirectLaunchFactoryAbi,
  ekuboRouterAbi,
  graduationAbi,
  launchFactoryAbi,
  marketAbi,
  nftCollectionFactoryAbi,
  nftDropControllerAbi,
  nftMarketplaceAbi,
  nftOffersAbi,
  nftPFPFactoryAbi,
  nftPFPMarketplaceAbi,
  poolManagerAbi,
  uniswapV3PoolAbi
} from "./abi.js";
import {
  chainDefinition,
  chainId,
  defaultRpcUrls,
  directDeployments,
  deployments,
  nftDeployments,
  poolManager,
  scopeForDeployment,
  stableQuoteToken,
  type IndexerDeployment
} from "./deployment.js";
import {
  ensureSchema,
  applyNFTTransfer,
  applyNFTOfferNonceFloor,
  cancelNFTOffer,
  cancelNFTPhase,
  cancelNFTListing,
  closeDatabase,
  getGraduatedLaunches,
  getIndexerState,
  getIndexerTextState,
  getSchemaVersion,
  EXPECTED_SCHEMA_VERSION,
  getNFTCollectionAddresses,
  getNFTCollectionStandards,
  insertNFTMint,
  insertNFTSale,
  insertNFTOfferFill,
  insertTrade,
  markGraduated,
  setIndexerState,
  setIndexerTextState,
  updateLaunchState,
  upsertNFTCollection,
  upsertNFTItem,
  upsertNFTPhase,
  upsertNFTListing,
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
let nftDeployment = nftDeployments[0];
const v4TickSpacing = 60;
const chunkSize = BigInt(process.env.LOG_CHUNK_SIZE || (chainId === 988 || chainId === 5042 ? "450" : "1900"));
const nftEventChunkSize = BigInt(process.env.NFT_EVENT_LOG_CHUNK_SIZE || "1900");
const nftTransferChunkSize = BigInt(process.env.NFT_TRANSFER_LOG_CHUNK_SIZE || "1900");
const rpcChunkDelayMs = Number(process.env.RPC_CHUNK_DELAY_MS || (chainId === 8453 ? "175" : "0"));
const pollMs = Number(process.env.POLL_MS || "1000");
const confirmations = BigInt(process.env.CONFIRMATIONS || "1");
const liveScopeConcurrency = Math.max(1, Number(process.env.LIVE_SCOPE_CONCURRENCY || "2"));
const totalSupplyRaw = 1_000_000_000n * 10n ** 18n;
const q192 = 1n << 192n;
const pfpListingKey = (listingId: bigint) => -listingId;
let isPolling = false;
let nextPollDelayMs = pollMs;
let lastSuccessfulPollAt = 0;
let lastIndexedBlock = 0n;
let lastPollError = "";
let lastPollDurationMs = 0;
let consecutiveFailures = 0;
let chainHeadBlock = 0n;
let confirmedHeadBlock = 0n;
let stopped = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
const startedAt = Date.now();
const healthPort = Number(process.env.HEALTH_PORT || "3000");

if (deploymentContexts.length === 0 && directDeployments.length === 0) {
  throw new Error("At least one Bond or Direct deployment must be configured");
}

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
  // Keep the configured order stable. Public RPCs can be fast while healthy but
  // become rate limited during a backfill; fallback will move to the next URL.
  transport: fallback(rpcUrls.map((url) => http(url, { retryCount: 0 })), { rank: false, retryCount: 0 })
});

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
}

async function checkpointIndexerState(key: string, nextBlock: bigint, isBackfilling = false) {
  await setIndexerState(key, nextBlock);
  // Backfills otherwise issue eth_getLogs requests in a tight loop and exhaust
  // every public provider in the fallback list within seconds. Never delay the
  // live-head pass: that path is latency-sensitive and already bounded to the
  // few blocks produced since the previous poll.
  if (isBackfilling && rpcChunkDelayMs > 0) await sleep(rpcChunkDelayMs);
}

await ensureSchema();
const schemaVersion = await getSchemaVersion();
const schemaReady = schemaVersion === EXPECTED_SCHEMA_VERSION;
if (!schemaReady) {
  console.warn("Indexer database migration is behind", { expected: EXPECTED_SCHEMA_VERSION, actual: schemaVersion || null });
  if (process.env.REQUIRE_SCHEMA_VERSION === "true") throw new Error(`Database schema ${EXPECTED_SCHEMA_VERSION} is required`);
}
const healthServer = createServer((request, response) => {
  const ageMs = lastSuccessfulPollAt ? Date.now() - lastSuccessfulPollAt : Date.now() - startedAt;
  const healthy = lastSuccessfulPollAt > 0
    ? ageMs <= Math.max(pollMs * 5, 180_000)
    : ageMs <= 600_000;
  const payload = JSON.stringify({
    status: healthy ? lastSuccessfulPollAt ? "ok" : "starting" : "stale",
    chainId,
    scopes: [
      ...deploymentContexts.map((deployment) => deployment.scope),
      ...directDeployments.map((deployment) => deployment.scope),
      ...nftDeployments.map((deployment) => deployment.scope)
    ],
    isPolling,
    schema: { ready: schemaReady, expected: EXPECTED_SCHEMA_VERSION, actual: schemaVersion || null },
    chainHeadBlock: chainHeadBlock.toString(),
    confirmedHeadBlock: confirmedHeadBlock.toString(),
    lastIndexedBlock: lastIndexedBlock.toString(),
    indexedLagBlocks: confirmedHeadBlock > lastIndexedBlock ? (confirmedHeadBlock - lastIndexedBlock).toString() : "0",
    lastPollDurationMs,
    consecutiveFailures,
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
  liveScopeConcurrency: liveScopeConcurrency.toString(),
  rpcEndpoints: rpcUrls.length.toString(),
  scopes: deploymentContexts.length + directDeployments.length + nftDeployments.length
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
  const pollStartedAt = Date.now();
  try {
    await backfillLoop();
    lastSuccessfulPollAt = Date.now();
    lastPollError = "";
    consecutiveFailures = 0;
    // Keep the requested cadence measured from poll start. A slow live pass
    // should not add another full interval before checking the next head.
    nextPollDelayMs = Math.max(0, pollMs - (Date.now() - pollStartedAt));
  } catch (error) {
    consecutiveFailures += 1;
    lastPollError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    const rateLimited = isRateLimitError(error);
    nextPollDelayMs = rateLimited
      ? Math.min(Math.max(nextPollDelayMs * 2, 60_000), 300_000)
      : pollMs;
    console.error(rateLimited ? "Indexer RPC rate limited; backing off" : "Indexer poll failed", error);
  } finally {
    lastPollDurationMs = Date.now() - pollStartedAt;
    isPolling = false;
  }
}

async function backfillLoop() {
  const head = await client.getBlockNumber();
  chainHeadBlock = head;
  if (head <= confirmations) return;
  const latest = head - confirmations;
  confirmedHeadBlock = latest;
  await verifyCanonicalCheckpoint(latest);
  if (chainId === 8453) {
    const { stakingStartBlock, updateStakingSnapshot } = await import("./staking-indexer.js");
    if (latest >= stakingStartBlock) {
      try {
        await updateStakingSnapshot(latest);
      } catch (error) {
        console.error("Staking snapshot indexing failed; retaining last successful snapshot", error);
      }
    }
  }
  for (const deployment of nftDeployments) {
    if (latest < deployment.startBlock) continue;
    nftDeployment = deployment;
    await backfillNFTCollections(latest);
    await backfillNFTPFPCollections(latest);
    await backfillNFTItems(latest);
    await Promise.all([
      backfillNFTPhases(latest),
      backfillNFTMints(latest),
      backfillNFTTransfers(latest),
      backfillNFTMarketplace(latest),
      backfillNFTPFPMarketplace(latest),
      backfillNFTOffers(latest)
    ]);
  }
  await mapWithConcurrency(deploymentContexts, liveScopeConcurrency, async (deployment) => {
    if (latest < deployment.startBlock) return;
    await backfillLaunchCreated(deployment, latest);
    await backfillMarketBuys(deployment, latest);
    await backfillMarketSells(deployment, latest);
    await backfillGraduations(deployment, latest);
    await backfillUniswapV4Swaps(deployment, latest);
  });
  await mapWithConcurrency(directDeployments, liveScopeConcurrency, async (directDeployment) => {
    if (latest < directDeployment.startBlock) return;
    await backfillDirectLaunches(directDeployment, latest);
    if (directDeployment.dexProvider === "ekubo") await backfillEkuboTrades(directDeployment, latest);
    else if (directDeployment.dexVersion === "v3") await backfillUniswapV3Swaps(directDeployment, latest);
    else await backfillUniswapV4Swaps(directDeployment, latest);
  });
  lastIndexedBlock = latest;
  const checkpoint = await client.getBlock({ blockNumber: latest });
  await setIndexerTextState(canonicalStateKey(), JSON.stringify({ block: latest.toString(), hash: checkpoint.hash }));
}

function canonicalStateKey() {
  return `chain:${chainId}:canonical_checkpoint`;
}

async function verifyCanonicalCheckpoint(latest: bigint) {
  const stored = await getIndexerTextState(canonicalStateKey());
  if (!stored) return;
  let checkpointBlock: bigint;
  let checkpointHash: string;
  try {
    const checkpoint = JSON.parse(stored) as { block?: string; hash?: string };
    checkpointBlock = BigInt(checkpoint.block || "");
    checkpointHash = checkpoint.hash || "";
  } catch {
    throw new Error("Canonical checkpoint is malformed; manual reconciliation is required");
  }
  if (!checkpointHash) throw new Error("Canonical checkpoint hash is missing");
  if (checkpointBlock > latest) {
    throw new Error(`RPC confirmed head ${latest} is behind canonical checkpoint ${checkpointBlock}`);
  }
  const block = await client.getBlock({ blockNumber: checkpointBlock });
  if (block.hash.toLowerCase() !== checkpointHash.toLowerCase()) {
    throw new Error(`REORG_DETECTED at block ${checkpointBlock}; manual reconciliation is required`);
  }
}

async function backfillNFTTransfers(latest: bigint) {
  if (!nftDeployment) return;
  const collections = await getNFTCollectionStandards(chainId);
  const editions = collections.filter((item) => item.standard === "ERC1155").map((item) => item.collection);
  const pfps = collections.filter((item) => item.standard === "ERC721").map((item) => item.collection);
  let fromBlock = (await getIndexerState(stateKey(nftDeployment, "transfers_last_block"))) ?? nftDeployment.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftTransferChunkSize > latest ? latest : fromBlock + nftTransferChunkSize;
    const events: Array<{ collection: `0x${string}`; tokenId: bigint; from: `0x${string}`; to: `0x${string}`; quantity: bigint; txHash: `0x${string}`; logIndex: number; batchIndex: number; blockNumber: bigint }> = [];
    if (editions.length) {
      const singles = await client.getContractEvents({ address: editions, abi: blueEdition1155Abi, eventName: "TransferSingle", fromBlock, toBlock });
      for (const log of singles) events.push({ collection: log.address, tokenId: log.args.id!, from: log.args.from!, to: log.args.to!, quantity: log.args.value!, txHash: log.transactionHash, logIndex: Number(log.logIndex), batchIndex: 0, blockNumber: log.blockNumber });
      const batches = await client.getContractEvents({ address: editions, abi: blueEdition1155Abi, eventName: "TransferBatch", fromBlock, toBlock });
      for (const log of batches) for (let index = 0; index < (log.args.ids?.length ?? 0); ++index) events.push({ collection: log.address, tokenId: log.args.ids![index], from: log.args.from!, to: log.args.to!, quantity: log.args.values![index], txHash: log.transactionHash, logIndex: Number(log.logIndex), batchIndex: index, blockNumber: log.blockNumber });
    }
    if (pfps.length) {
      const transfers = await client.getContractEvents({ address: pfps, abi: bluePFP721Abi, eventName: "Transfer", fromBlock, toBlock });
      for (const log of transfers) events.push({ collection: log.address, tokenId: log.args.tokenId!, from: log.args.from!, to: log.args.to!, quantity: 1n, txHash: log.transactionHash, logIndex: Number(log.logIndex), batchIndex: 0, blockNumber: log.blockNumber });
    }
    events.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex || a.batchIndex - b.batchIndex);
    for (const event of events) await applyNFTTransfer({ chainId, ...event });
    await checkpointIndexerState(stateKey(nftDeployment, "transfers_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
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

    await checkpointIndexerState(stateKey(deployment, "launch_factory_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillDirectLaunches(
  deployment: ScopeContext & { launchFactory: `0x${string}`; liquidityLocker: `0x${string}`; eventKind?: "standard" | "arc" | "ekubo" },
  latest: bigint
) {
  let fromBlock = (await getIndexerState(stateKey(deployment, "direct_launches_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    if (deployment.eventKind === "arc") {
      const logs = await client.getContractEvents({
        address: deployment.launchFactory,
        abi: arcDirectLaunchFactoryAbi,
        eventName: "ArcDirectLaunchCreated",
        fromBlock,
        toBlock
      });
      for (const log of logs) await handleArcDirectLaunchCreated(deployment, log);
      await checkpointIndexerState(stateKey(deployment, "direct_launches_last_block"), toBlock + 1n, toBlock < latest);
      fromBlock = toBlock + 1n;
      continue;
    }
    if (deployment.eventKind === "ekubo") {
      const logs = await client.getContractEvents({
        address: deployment.launchFactory,
        abi: ekuboDirectLaunchFactoryAbi,
        eventName: "EkuboDirectLaunchCreated",
        fromBlock,
        toBlock
      });
      for (const log of logs) await handleEkuboDirectLaunchCreated(deployment, log);
      await checkpointIndexerState(stateKey(deployment, "direct_launches_last_block"), toBlock + 1n, toBlock < latest);
      fromBlock = toBlock + 1n;
      continue;
    }
    const logs = await client.getContractEvents({
      address: deployment.launchFactory,
      abi: directLaunchFactoryAbi,
      eventName: "DirectLaunchCreated",
      fromBlock,
      toBlock
    });
    for (const log of logs) await handleDirectLaunchCreated(deployment, log);
    await checkpointIndexerState(stateKey(deployment, "direct_launches_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function handleEkuboDirectLaunchCreated(
  deployment: ScopeContext & { liquidityLocker: `0x${string}` },
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof ekuboDirectLaunchFactoryAbi, "EkuboDirectLaunchCreated">>>[number]
) {
  const metadata: LaunchMetadata = await readLaunchMetadata(log.args.contractURI || "").catch(() => ({}));
  const cdnImage = metadata.image
    ? await mirrorTokenImage(metadata.image, chainId, log.args.token!).catch(() => undefined)
    : undefined;
  await upsertLaunch(deployment.scope, {
    id: log.args.launchId!, token: log.args.token!, creator: log.args.creator!,
    name: log.args.name!, symbol: log.args.symbol!, contractURI: log.args.contractURI!,
    imageUri: cdnImage || metadata.image, description: metadata.description,
    website: metadata.website, twitter: metadata.twitter, telegram: metadata.telegram, discord: metadata.discord,
    launchMode: "direct", dexProvider: "ekubo", poolFee: 0,
    tickSpacing: Number(log.args.tickSpacing!), liquidityLocker: deployment.liquidityLocker,
    txHash: log.transactionHash, blockNumber: log.blockNumber
  });
  await markGraduated(deployment.scope, {
    launchId: log.args.launchId!, token: log.args.token!, positionId: log.args.positionId!,
    poolId: log.args.poolId!, txHash: log.transactionHash, blockNumber: log.blockNumber
  });
  const block = await client.getBlock({ blockNumber: log.blockNumber });
  await updateLaunchState(deployment.scope, {
    id: log.args.launchId!, status: "graduated", raisedEth: 0n, graduationTargetEth: 0n,
    progress: 100, creatorAllocation: 0n, tokenCreatedAt: block.timestamp
  });
}

async function backfillEkuboTrades(
  deployment: ScopeContext & { swapRouter?: `0x${string}` },
  latest: bigint
) {
  if (!deployment.swapRouter) return;
  let fromBlock = (await getIndexerState(stateKey(deployment, "ekubo_trades_last_block"))) ?? deployment.startBlock;
  if (fromBlock < deployment.startBlock) fromBlock = deployment.startBlock;
  const launches = await getGraduatedLaunches(deployment.scope);
  const byToken = new Map(launches.map((launch) => [launch.token.toLowerCase(), launch.launchId]));
  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const [buys, sells] = await Promise.all([
      client.getContractEvents({ address: deployment.swapRouter, abi: ekuboRouterAbi, eventName: "EkuboBuy", fromBlock, toBlock }),
      client.getContractEvents({ address: deployment.swapRouter, abi: ekuboRouterAbi, eventName: "EkuboSell", fromBlock, toBlock })
    ]);
    for (const log of buys) {
      const launchId = byToken.get(log.args.token!.toLowerCase());
      if (launchId === undefined) continue;
      await insertTrade(deployment.scope, {
        launchId, trader: log.args.buyer!, side: "buy", source: "ekubo",
        ethAmount: log.args.grossNativeIn!, tokenAmount: log.args.tokenOut!,
        marketCapEth: log.args.tokenOut! > 0n ? (log.args.grossNativeIn! * totalSupplyRaw) / log.args.tokenOut! : undefined,
        txHash: log.transactionHash, blockNumber: log.blockNumber
      });
    }
    for (const log of sells) {
      const launchId = byToken.get(log.args.token!.toLowerCase());
      if (launchId === undefined) continue;
      await insertTrade(deployment.scope, {
        launchId, trader: log.args.seller!, side: "sell", source: "ekubo",
        ethAmount: log.args.nativeOut!, tokenAmount: log.args.grossTokenIn!,
        marketCapEth: log.args.grossTokenIn! > 0n ? (log.args.nativeOut! * totalSupplyRaw) / log.args.grossTokenIn! : undefined,
        txHash: log.transactionHash, blockNumber: log.blockNumber
      });
    }
    await checkpointIndexerState(stateKey(deployment, "ekubo_trades_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function handleArcDirectLaunchCreated(
  deployment: ScopeContext & { liquidityLocker: `0x${string}` },
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof arcDirectLaunchFactoryAbi, "ArcDirectLaunchCreated">>>[number]
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
    poolFee: 10_000,
    tickSpacing: 200,
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

async function backfillNFTCollections(latest: bigint) {
  if (!nftDeployment) return;
  let fromBlock = (await getIndexerState(stateKey(nftDeployment, "collections_last_block"))) ?? nftDeployment.startBlock;
  if (fromBlock < nftDeployment.startBlock) fromBlock = nftDeployment.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const logs = await client.getContractEvents({
      address: nftDeployment.collectionFactory,
      abi: nftCollectionFactoryAbi,
      eventName: "NFTCollectionCreated",
      fromBlock,
      toBlock
    });
    for (const log of logs) {
      await upsertNFTCollection({
        chainId,
        collectionId: log.args.collectionId!,
        collection: log.args.collection!,
        factory: nftDeployment.collectionFactory,
        creator: log.args.creator!,
        name: log.args.name!,
        symbol: log.args.symbol!,
        contractURI: log.args.contractURI!,
        initialTokenId: log.args.initialTokenId!,
        initialMaxSupply: log.args.initialMaxSupply!,
        royaltyBps: Number(log.args.royaltyBps!),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber
      });
      await upsertNFTItem({
        chainId,
        collection: log.args.collection!,
        tokenId: log.args.initialTokenId!,
        maxSupply: log.args.initialMaxSupply!,
        metadataURI: log.args.initialItemURI!,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber
      });
    }
    await checkpointIndexerState(stateKey(nftDeployment, "collections_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTPFPCollections(latest: bigint) {
  if (!nftDeployment?.pfpFactory || !nftDeployment.pfpStartBlock) return;
  const context = { scope: `${nftDeployment.scope}:pfp`, startBlock: nftDeployment.pfpStartBlock };
  let fromBlock = (await getIndexerState(stateKey(context, "collections_last_block"))) ?? context.startBlock;
  if (fromBlock < context.startBlock) fromBlock = context.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const logs = await client.getContractEvents({ address: nftDeployment.pfpFactory, abi: nftPFPFactoryAbi, eventName: "PFPCollectionCreated", fromBlock, toBlock });
    for (const log of logs) await upsertNFTCollection({
      chainId, collectionId: log.args.collectionId!, collection: log.args.collection!, factory: nftDeployment.pfpFactory,
      creator: log.args.creator!, name: log.args.name!, symbol: log.args.symbol!, contractURI: log.args.contractURI!,
      standard: "ERC721",
      initialTokenId: 1n, initialMaxSupply: log.args.maxSupply!, royaltyBps: Number(log.args.royaltyBps!),
      txHash: log.transactionHash, blockNumber: log.blockNumber
    });
    for (const log of logs) await upsertNFTItem({
      chainId,
      collection: log.args.collection!,
      tokenId: 1n,
      maxSupply: log.args.maxSupply!,
      metadataURI: log.args.contractURI!,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber
    });
    await checkpointIndexerState(stateKey(context, "collections_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTItems(latest: bigint) {
  if (!nftDeployment) return;
  const addresses = await getNFTCollectionAddresses(chainId);
  if (addresses.length === 0) return;
  let fromBlock = (await getIndexerState(stateKey(nftDeployment, "items_last_block"))) ?? nftDeployment.startBlock;
  if (fromBlock < nftDeployment.startBlock) fromBlock = nftDeployment.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const logs = await client.getContractEvents({
      address: addresses,
      abi: blueEdition1155Abi,
      eventName: "ItemCreated",
      fromBlock,
      toBlock
    });
    for (const log of logs) {
      await upsertNFTItem({
        chainId,
        collection: log.address,
        tokenId: log.args.tokenId!,
        maxSupply: log.args.maxSupply!,
        metadataURI: log.args.uri!,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber
      });
    }
    await checkpointIndexerState(stateKey(nftDeployment, "items_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTPhases(latest: bigint) {
  if (!nftDeployment) return;
  const registeredCollections = new Set(
    (await getNFTCollectionAddresses(chainId)).map((collection) => collection.toLowerCase())
  );
  let fromBlock = (await getIndexerState(stateKey(nftDeployment, "phases_last_block"))) ?? nftDeployment.startBlock;
  if (fromBlock < nftDeployment.startBlock) fromBlock = nftDeployment.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const created = await client.getContractEvents({
      address: nftDeployment.dropController,
      abi: nftDropControllerAbi,
      eventName: "PhaseCreated",
      fromBlock,
      toBlock
    });
    const updated = await client.getContractEvents({
      address: nftDeployment.dropController,
      abi: nftDropControllerAbi,
      eventName: "PhaseUpdated",
      fromBlock,
      toBlock
    });
    for (const log of [...created, ...updated]) {
      if (!registeredCollections.has(log.args.collection!.toLowerCase())) continue;
      const config = log.args.config!;
      await upsertNFTPhase({
        chainId,
        collection: log.args.collection!,
        tokenId: log.args.tokenId!,
        phaseId: log.args.phaseId!,
        phaseType: Number(config.phaseType),
        limitMode: Number(config.limitMode),
        currency: config.currency,
        mintPrice: config.mintPrice,
        startTime: config.startTime,
        endTime: config.endTime,
        phaseSupplyCap: config.phaseSupplyCap,
        defaultWalletLimit: BigInt(config.defaultWalletLimit),
        maxPerTransaction: BigInt(config.maxPerTransaction),
        merkleRoot: config.merkleRoot,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber
      });
    }
    const cancelled = await client.getContractEvents({
      address: nftDeployment.dropController,
      abi: nftDropControllerAbi,
      eventName: "PhaseCancelledEvent",
      fromBlock,
      toBlock
    });
    for (const log of cancelled) {
      if (!registeredCollections.has(log.args.collection!.toLowerCase())) continue;
      await cancelNFTPhase(chainId, log.args.collection!, log.args.tokenId!, log.args.phaseId!);
    }
    await checkpointIndexerState(stateKey(nftDeployment, "phases_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTMints(latest: bigint) {
  if (!nftDeployment) return;
  const registeredCollections = new Set(
    (await getNFTCollectionAddresses(chainId)).map((collection) => collection.toLowerCase())
  );
  let fromBlock = (await getIndexerState(stateKey(nftDeployment, "mints_last_block"))) ?? nftDeployment.startBlock;
  if (fromBlock < nftDeployment.startBlock) fromBlock = nftDeployment.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const logs = await client.getContractEvents({
      address: nftDeployment.dropController,
      abi: nftDropControllerAbi,
      eventName: "NFTMinted",
      fromBlock,
      toBlock
    });
    for (const log of logs) {
      if (!registeredCollections.has(log.args.collection!.toLowerCase())) continue;
      await insertNFTMint({
        chainId,
        collection: log.args.collection!,
        tokenId: log.args.tokenId!,
        phaseId: log.args.phaseId!,
        payer: log.args.payer!,
        recipient: log.args.recipient!,
        quantity: log.args.quantity!,
        unitPrice: log.args.unitPrice!,
        grossAmount: log.args.grossAmount!,
        platformFee: log.args.platformFee!,
        txHash: log.transactionHash,
        logIndex: Number(log.logIndex),
        blockNumber: log.blockNumber
      });
    }
    await checkpointIndexerState(stateKey(nftDeployment, "mints_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTMarketplace(latest: bigint) {
  if (!nftDeployment) return;
  let fromBlock = (await getIndexerState(stateKey(nftDeployment, "marketplace_last_block"))) ?? nftDeployment.startBlock;
  if (fromBlock < nftDeployment.startBlock) fromBlock = nftDeployment.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const created = await client.getContractEvents({
      address: nftDeployment.marketplace, abi: nftMarketplaceAbi, eventName: "ListingCreated", fromBlock, toBlock
    });
    for (const log of created) await upsertNFTListing({
      chainId, marketplace: nftDeployment.marketplace, listingId: log.args.listingId!, seller: log.args.seller!, collection: log.args.collection!,
      tokenId: log.args.tokenId!, quantity: log.args.quantity!, unitPrice: log.args.unitPrice!,
      startTime: log.args.startTime!, endTime: log.args.endTime!, txHash: log.transactionHash, blockNumber: log.blockNumber
    });
    const cancelled = await client.getContractEvents({
      address: nftDeployment.marketplace, abi: nftMarketplaceAbi, eventName: "ListingCancelled", fromBlock, toBlock
    });
    for (const log of cancelled) await cancelNFTListing(chainId, nftDeployment.marketplace, log.args.listingId!);
    const purchased = await client.getContractEvents({
      address: nftDeployment.marketplace, abi: nftMarketplaceAbi, eventName: "ListingPurchased", fromBlock, toBlock
    });
    for (const log of purchased) await insertNFTSale({
      chainId, marketplace: nftDeployment.marketplace, listingId: log.args.listingId!, buyer: log.args.buyer!, recipient: log.args.recipient!,
      quantity: log.args.quantity!, grossAmount: log.args.grossAmount!, platformFee: log.args.platformFee!,
      royaltyRecipient: log.args.royaltyRecipient!, royaltyAmount: log.args.royaltyAmount!,
      txHash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: log.blockNumber
    });
    await checkpointIndexerState(stateKey(nftDeployment, "marketplace_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTPFPMarketplace(latest: bigint) {
  if (!nftDeployment?.pfpMarketplace || !nftDeployment.pfpStartBlock) return;
  const context = { scope: `${nftDeployment.scope}:pfp-market`, startBlock: nftDeployment.pfpStartBlock };
  let fromBlock = (await getIndexerState(stateKey(context, "marketplace_last_block"))) ?? context.startBlock;
  if (fromBlock < context.startBlock) fromBlock = context.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const created = await client.getContractEvents({ address: nftDeployment.pfpMarketplace, abi: nftPFPMarketplaceAbi, eventName: "ListingCreated", fromBlock, toBlock });
    for (const log of created) await upsertNFTListing({
      chainId, marketplace: nftDeployment.pfpMarketplace, listingId: pfpListingKey(log.args.listingId!), seller: log.args.seller!, collection: log.args.collection!,
      tokenId: log.args.tokenId!, quantity: 1n, unitPrice: log.args.price!, startTime: log.args.startTime!,
      endTime: log.args.endTime!, txHash: log.transactionHash, blockNumber: log.blockNumber
    });
    const cancelled = await client.getContractEvents({ address: nftDeployment.pfpMarketplace, abi: nftPFPMarketplaceAbi, eventName: "ListingCancelled", fromBlock, toBlock });
    for (const log of cancelled) await cancelNFTListing(chainId, nftDeployment.pfpMarketplace, pfpListingKey(log.args.listingId!));
    const purchased = await client.getContractEvents({ address: nftDeployment.pfpMarketplace, abi: nftPFPMarketplaceAbi, eventName: "ListingPurchased", fromBlock, toBlock });
    for (const log of purchased) await insertNFTSale({
      chainId, marketplace: nftDeployment.pfpMarketplace, listingId: pfpListingKey(log.args.listingId!), buyer: log.args.buyer!, recipient: log.args.recipient!, quantity: 1n,
      grossAmount: log.args.grossAmount!, platformFee: log.args.platformFee!, royaltyRecipient: log.args.royaltyRecipient!,
      royaltyAmount: log.args.royaltyAmount!, txHash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: log.blockNumber
    });
    await checkpointIndexerState(stateKey(context, "marketplace_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillNFTOffers(latest: bigint) {
  if (!nftDeployment?.offers || !nftDeployment.offersStartBlock) return;
  const context = { scope: `${nftDeployment.scope}:offers`, startBlock: nftDeployment.offersStartBlock };
  let fromBlock = (await getIndexerState(stateKey(context, "offers_last_block"))) ?? context.startBlock;
  if (fromBlock < context.startBlock) fromBlock = context.startBlock;
  while (fromBlock <= latest) {
    const toBlock = fromBlock + nftEventChunkSize > latest ? latest : fromBlock + nftEventChunkSize;
    const cancelled = await client.getContractEvents({ address: nftDeployment.offers, abi: nftOffersAbi, eventName: "OfferCancelled", fromBlock, toBlock });
    for (const log of cancelled) await cancelNFTOffer(chainId, nftDeployment.offers, log.args.offerHash!);
    const floors = await client.getContractEvents({ address: nftDeployment.offers, abi: nftOffersAbi, eventName: "AllOffersCancelled", fromBlock, toBlock });
    for (const log of floors) await applyNFTOfferNonceFloor(chainId, nftDeployment.offers, log.args.maker!, log.args.newMinimumNonce!);
    const accepted = await client.getContractEvents({ address: nftDeployment.offers, abi: nftOffersAbi, eventName: "OfferAccepted", fromBlock, toBlock });
    for (const log of accepted) await insertNFTOfferFill({
      chainId, offersContract: nftDeployment.offers, offerHash: log.args.offerHash!, maker: log.args.maker!, seller: log.args.seller!,
      collection: log.args.collection!, tokenId: log.args.tokenId!, quantity: log.args.quantity!,
      grossAmount: log.args.grossAmount!, platformFee: log.args.platformFee!,
      royaltyRecipient: log.args.royaltyRecipient!, royaltyAmount: log.args.royaltyAmount!,
      standard: Number(log.args.standard!), offerType: Number(log.args.offerType!),
      txHash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: log.blockNumber
    });
    await checkpointIndexerState(stateKey(context, "offers_last_block"), toBlock + 1n, toBlock < latest);
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

    await checkpointIndexerState(stateKey(deployment, "market_buys_v2_last_block"), toBlock + 1n, toBlock < latest);
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

    await checkpointIndexerState(stateKey(deployment, "market_sells_v2_last_block"), toBlock + 1n, toBlock < latest);
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

    await checkpointIndexerState(stateKey(deployment, "graduations_last_block"), toBlock + 1n, toBlock < latest);
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

    await checkpointIndexerState(stateKey(deployment, "uniswap_v4_swaps_v3_last_block"), toBlock + 1n, toBlock < latest);
    fromBlock = toBlock + 1n;
  }
}

async function backfillUniswapV3Swaps(deployment: ScopeContext, latest: bigint) {
  const launched = await getGraduatedLaunches(deployment.scope);
  if (launched.length === 0) return;

  const poolMap = new Map<string, { launchId: bigint; token: `0x${string}` }>();
  let firstLaunchBlock = latest;
  for (const launch of launched) {
    if (!launch.poolId) continue;
    const pool = getAddress(`0x${launch.poolId.slice(-40)}`);
    poolMap.set(pool.toLowerCase(), {
      launchId: launch.launchId,
      token: getAddress(launch.token) as `0x${string}`
    });
    if (launch.blockNumber && launch.blockNumber < firstLaunchBlock) firstLaunchBlock = launch.blockNumber;
  }
  if (poolMap.size === 0) return;

  let fromBlock =
    (await getIndexerState(stateKey(deployment, "uniswap_v3_swaps_last_block"))) ?? firstLaunchBlock;
  if (fromBlock < firstLaunchBlock) fromBlock = firstLaunchBlock;
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + chunkSize > latest ? latest : fromBlock + chunkSize;
    const logs = await client.getContractEvents({
      address: Array.from(poolMap.keys()) as `0x${string}`[],
      abi: uniswapV3PoolAbi,
      eventName: "Swap",
      fromBlock,
      toBlock
    });
    for (const log of logs) {
      const launch = poolMap.get(log.address.toLowerCase());
      if (!launch) continue;
      await handleUniswapV3Swap(deployment, log, launch);
    }
    await checkpointIndexerState(stateKey(deployment, "uniswap_v3_swaps_last_block"), toBlock + 1n, toBlock < latest);
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
      if (!response.ok || !isJsonResponse(response)) continue;
      const metadata = await readLimitedJson(response, 256 * 1024) as {
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
  if (uri.startsWith("https://")) return isTrustedMetadataUrl(uri) ? [uri] : [];
  if (!uri.startsWith("ipfs://")) return [];
  const cidPath = uri.replace("ipfs://", "");
  const gateway = process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs";
  return [
    `${gateway.replace(/\/$/, "")}/${cidPath}`,
    `https://ipfs.io/ipfs/${cidPath}`,
    `https://cloudflare-ipfs.com/ipfs/${cidPath}`
  ];
}

function isTrustedMetadataUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const configuredHost = process.env.PINATA_GATEWAY_URL
      ? new URL(process.env.PINATA_GATEWAY_URL).hostname.toLowerCase()
      : "gateway.pinata.cloud";
    const host = url.hostname.toLowerCase();
    return host === configuredHost
      || host === "ipfs.io"
      || host === "cloudflare-ipfs.com"
      || host.endsWith(".mypinata.cloud");
  } catch {
    return false;
  }
}

function isJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  return contentType.includes("application/json") || contentType.includes("text/plain") || contentType === "";
}

async function readLimitedJson(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > maxBytes) throw new Error("Metadata response is too large");
  if (!response.body) throw new Error("Metadata response is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Metadata response is too large");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body) as unknown;
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

async function handleUniswapV3Swap(
  deployment: ScopeContext,
  log: Awaited<ReturnType<typeof client.getContractEvents<typeof uniswapV3PoolAbi, "Swap">>>[number],
  launch: { launchId: bigint; token: `0x${string}` }
) {
  const amount0 = log.args.amount0!;
  const amount1 = log.args.amount1!;
  if (amount0 === 0n || amount1 === 0n) return;

  const quoteIsToken0 = stableQuoteToken.toLowerCase() < launch.token.toLowerCase();
  const quoteDelta = quoteIsToken0 ? amount0 : amount1;
  const tokenDelta = quoteIsToken0 ? amount1 : amount0;
  const side = quoteDelta > 0n ? "buy" : "sell";
  const quoteAmount18 = absBigInt(quoteDelta) * 1_000_000_000_000n;
  const tokenAmount = absBigInt(tokenDelta);
  const trader = await readTransactionSender(log.transactionHash).catch(() => log.args.sender!);
  const sqrtPrice = log.args.sqrtPriceX96!;
  const sqrtSquared = sqrtPrice * sqrtPrice;
  const marketCapEth = quoteIsToken0
    ? (q192 * 10n ** 39n) / sqrtSquared
    : (sqrtSquared * 10n ** 39n) / q192;

  await insertTrade(deployment.scope, {
    launchId: launch.launchId,
    trader,
    side,
    source: "uniswap_v3",
    ethAmount: quoteAmount18,
    tokenAmount,
    marketCapEth,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber
  });
}

function blueFunV4PoolId(token: `0x${string}`, deployment: ScopeContext & { version?: IndexerDeployment["version"]; feeHook?: `0x${string}` }) {
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
        hooks: vNext ? deployment.feeHook ?? zeroAddress : zeroAddress
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
