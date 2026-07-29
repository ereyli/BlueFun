import { createPublicClient, fallback, getAddress, http } from "viem";
import { arcChain } from "@/lib/arc-chain";
import { arcAddresses, arcDirectLaunchFactoryAbi } from "@/lib/contracts";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { arcRpcUrls } from "@/lib/rpc";
import { readTokenMetadata, type TokenMetadata } from "@/lib/token-metadata";

const arcClient = createPublicClient({
  chain: arcChain,
  transport: fallback(arcRpcUrls().map((url) => http(url)), { rank: true, retryCount: 1 })
});
const arcDirectFactory = arcAddresses.directLaunchFactory as `0x${string}`;

type ArcLaunchEvent = Awaited<ReturnType<typeof readArcLaunchEvents>>[number];
let arcLaunchCache: { expiresAt: number; launches: DeployedLaunch[] } | undefined;
let arcLaunchRequest: Promise<DeployedLaunch[]> | undefined;

export async function getArcOnchainLaunches(): Promise<DeployedLaunch[]> {
  if (arcLaunchCache && arcLaunchCache.expiresAt > Date.now()) return arcLaunchCache.launches;
  if (arcLaunchRequest) return arcLaunchRequest;
  arcLaunchRequest = loadArcOnchainLaunches();
  try {
    const launches = await arcLaunchRequest;
    arcLaunchCache = { expiresAt: Date.now() + 10_000, launches };
    return launches;
  } finally {
    arcLaunchRequest = undefined;
  }
}

async function loadArcOnchainLaunches(): Promise<DeployedLaunch[]> {
  const events = await readArcLaunchEvents();
  const maxLaunches = Math.min(Math.max(Number(process.env.MAX_ONCHAIN_FALLBACK_LAUNCHES || "100"), 1), 500);
  const selected = events
    .filter((event) => event.args.launchId !== undefined && event.args.token && event.args.creator)
    .sort((left, right) => compareEventPosition(right, left))
    .slice(0, maxLaunches);
  const blockTimestamps = new Map<string, Promise<number>>();

  const launches = await Promise.all(selected.map(async (event) => {
    const contractURI = event.args.contractURI || "";
    const metadata = await readTokenMetadata(contractURI).catch((): TokenMetadata => ({}));
    const createdAt = await blockTimestamp(event.blockNumber, blockTimestamps);
    return mapArcLaunch(event, metadata, createdAt);
  }));

  return launches;
}

export async function getArcOnchainLaunch(id: string) {
  return (await getArcOnchainLaunches()).find((launch) => launch.id === id);
}

export async function getArcOnchainLaunchByToken(token: string) {
  return (await getArcOnchainLaunches()).find((launch) => launch.token.toLowerCase() === token.toLowerCase());
}

export async function getArcOnchainLaunchBySuffix(suffix: string) {
  const matches = (await getArcOnchainLaunches())
    .filter((launch) => launch.token.toLowerCase().endsWith(suffix.toLowerCase()));
  return matches.length === 1 ? matches[0] : undefined;
}

async function readArcLaunchEvents() {
  const latestBlock = await arcClient.getBlockNumber();
  const deploymentBlock = arcAddresses.directDeploymentBlock || arcAddresses.deploymentBlock;
  const chunkSize = BigInt(process.env.ARC_ONCHAIN_LOG_CHUNK_SIZE || "450");
  const events: Awaited<ReturnType<typeof arcClient.getContractEvents<typeof arcDirectLaunchFactoryAbi, "ArcDirectLaunchCreated">>> = [];

  for (let fromBlock = deploymentBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
    const toBlock = fromBlock + chunkSize - 1n > latestBlock ? latestBlock : fromBlock + chunkSize - 1n;
    const chunk = await arcClient.getContractEvents({
      address: arcDirectFactory,
      abi: arcDirectLaunchFactoryAbi,
      eventName: "ArcDirectLaunchCreated",
      fromBlock,
      toBlock
    });
    events.push(...chunk);
  }

  return events;
}

function mapArcLaunch(event: ArcLaunchEvent, metadata: TokenMetadata, createdAt: number): DeployedLaunch {
  const launchId = event.args.launchId as bigint;
  const token = getAddress(event.args.token as `0x${string}`) as `0x${string}`;
  const creator = getAddress(event.args.creator as `0x${string}`) as `0x${string}`;
  const factory = arcDirectFactory.toLowerCase();

  return {
    chainId: arcChain.id,
    scope: `${arcChain.id}:direct:${factory}:${(arcAddresses.directDeploymentBlock || arcAddresses.deploymentBlock).toString()}`,
    launchMode: "direct",
    poolFee: 10_000,
    tickSpacing: 200,
    liquidityLocker: arcAddresses.directLiquidityLocker,
    id: launchId.toString(),
    token,
    creator,
    name: event.args.name || `Arc Launch #${launchId.toString()}`,
    symbol: event.args.symbol || `ARC-${launchId.toString()}`,
    contractURI: event.args.contractURI || "",
    description: metadata.description,
    imageURI: metadata.imageURI,
    website: metadata.website,
    twitter: metadata.twitter,
    telegram: metadata.telegram,
    discord: metadata.discord,
    positionId: event.args.positionId,
    createdBlock: event.blockNumber.toString(),
    status: "Graduated",
    raised: "0 USDC",
    target: "Direct",
    progress: 100,
    holders: "onchain",
    volume: "0 USDC",
    age: formatAge(createdAt),
    risk: "LP locked",
    price: "0 USDC",
    marketCap: "0 USDC"
  };
}

async function blockTimestamp(blockNumber: bigint, cache: Map<string, Promise<number>>) {
  const key = blockNumber.toString();
  let request = cache.get(key);
  if (!request) {
    request = arcClient.getBlock({ blockNumber }).then((block) => Number(block.timestamp));
    cache.set(key, request);
  }
  return request;
}

function compareEventPosition(left: ArcLaunchEvent, right: ArcLaunchEvent) {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber > right.blockNumber ? 1 : -1;
  const leftIndex = left.logIndex ?? 0;
  const rightIndex = right.logIndex ?? 0;
  return leftIndex === rightIndex ? 0 : leftIndex > rightIndex ? 1 : -1;
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
