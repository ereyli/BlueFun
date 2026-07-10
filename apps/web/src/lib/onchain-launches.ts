import { createPublicClient, fallback, formatEther, getAddress, http, zeroAddress } from "viem";
import { baseChain } from "@/lib/base-chain";
import { addresses, b20TokenAbi, bondingCurveAbi, launchFactoryAbi } from "@/lib/contracts";
import { getDbLaunch, getDbLaunches } from "@/lib/db-launches";
import { baseRpcUrls } from "@/lib/rpc";
import { readTokenMetadata, type TokenMetadata } from "@/lib/token-metadata";

export type DeployedLaunch = {
  chainId: number;
  id: string;
  token: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  contractURI: string;
  description?: string;
  imageURI?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  status: "Live" | "Ready" | "Graduated";
  raised: string;
  target: string;
  progress: number;
  holders: string;
  volume: string;
  age: string;
  risk: string;
  price: string;
  marketCap: string;
};

export type DeployedTrade = {
  side: "buy" | "sell";
  source?: "curve" | "uniswap_v4";
  trader?: `0x${string}`;
  ethAmount: string;
  tokenAmount: string;
  marketCapEth?: string;
  txHash: string;
  blockNumber: string;
  createdAt: string;
};

const publicClient = createPublicClient({
  chain: baseChain,
  transport: fallback(baseRpcUrls().map((url) => http(url)), { rank: true, retryCount: 1 })
});

export async function getDeployedLaunches(): Promise<DeployedLaunch[]> {
  if (!addresses.launchFactory || !addresses.bondingCurveMarket) return [];

  if (process.env.POSTGRES_INDEXER_ENABLED === "true") {
    const dbLaunches = await getDbLaunches().catch(() => undefined);
    if (dbLaunches) return dbLaunches;
    if (!onchainFallbackEnabled()) return [];

    return getLaunchesFromMarket().catch((error) => {
      console.error("Failed to load onchain launch fallback", error);
      return [];
    });
  }

  try {
    return await getLaunchesFromMarket();
  } catch (error) {
    console.error("Failed to load deployed launches", error);
    return [];
  }
}

export async function getDeployedLaunch(id: string): Promise<DeployedLaunch | undefined> {
  if (!addresses.bondingCurveMarket) return undefined;

  if (process.env.POSTGRES_INDEXER_ENABLED === "true") {
    const dbLaunch = await getDbLaunch(id).catch(() => undefined);
    if (dbLaunch) return dbLaunch;
  }

  try {
    return await getLaunchFromMarket(BigInt(id));
  } catch (error) {
    console.error("Failed to load direct launch state", error);
  }

  const launches = await getDeployedLaunches();
  return launches.find((launch) => launch.id === id);
}

export async function getLaunchTrades(id: string): Promise<DeployedTrade[]> {
  if (process.env.POSTGRES_INDEXER_ENABLED === "true") {
    const { getDbTrades } = await import("@/lib/db-launches");
    const dbTrades = await getDbTrades(id).catch(() => undefined);
    if (dbTrades) return dbTrades;
    if (!onchainFallbackEnabled()) return [];

    return getRecentOnchainTrades(id).catch((error) => {
      console.error("Failed to load recent onchain trade fallback", error);
      return [];
    });
  }

  return getRecentOnchainTrades(id).catch(() => []);
}

function onchainFallbackEnabled() {
  return process.env.NEXT_PUBLIC_ONCHAIN_FALLBACK_ENABLED === "true"
    || process.env.ONCHAIN_FALLBACK_ENABLED === "true";
}

function trimEth(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  if (whole === "0" && !trimmed && fraction.replace(/0/g, "")) return "<0.0001";
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function trimPriceEth(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, 18).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

async function getLaunchesFromMarket() {
  const count = await publicClient.readContract({
    address: addresses.bondingCurveMarket!,
    abi: bondingCurveAbi,
    functionName: "launchCount"
  });

  const eventMap = await getLaunchCreatedEventMap(count);
  const ids = Array.from({ length: Number(count) }, (_, index) => BigInt(index + 1));
  const launchResults = await Promise.allSettled(
    ids.map((id) => getLaunchFromMarket(id, eventMap.get(id.toString())))
  );
  const launches = launchResults.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    console.error(`Failed to load launch ${ids[index]?.toString()}`, result.reason);
    return [];
  });

  return launches.sort((a, b) => Number(b.id) - Number(a.id));
}

async function getLaunchFromMarket(
  id: bigint,
  event?: { name: string; symbol: string; contractURI: string }
): Promise<DeployedLaunch> {
  const state = await readLaunchState(id);
  const launchEvent = event ?? await getLaunchCreatedEvent(id).catch((error) => {
    console.error(`Failed to load launch metadata event ${id.toString()}`, error);
    return undefined;
  });

  const token = getAddress(state[0]) as `0x${string}`;
  if (token === zeroAddress) throw new Error(`Launch ${id.toString()} does not exist`);

  const [name, symbol] = await Promise.all([
    launchEvent?.name ? Promise.resolve(launchEvent.name) : readTokenString(token, "name", `B20 Launch #${id.toString()}`),
    launchEvent?.symbol ? Promise.resolve(launchEvent.symbol) : readTokenString(token, "symbol", `B20-${id.toString()}`)
  ]);

  const grossEthRaised = state[5];
  const graduationEthTarget = state[6];
  const maxSupply = state[7];
  const virtualTokenReserve = state[2];
  const virtualEthReserve = state[3];
  const fdvEth = virtualTokenReserve === 0n ? 0n : (virtualEthReserve * maxSupply) / virtualTokenReserve;
  const priceEth = virtualTokenReserve === 0n ? 0n : (virtualEthReserve * 1_000_000_000_000_000_000n) / virtualTokenReserve;
  const progress = graduationEthTarget === 0n ? 0 : Number((grossEthRaised * 100n) / graduationEthTarget);
  const status: DeployedLaunch["status"] = state[16] ? "Graduated" : state[15] ? "Ready" : "Live";
  const contractURI = launchEvent?.contractURI || "";
  const metadata = await readTokenMetadata(contractURI).catch((): TokenMetadata => ({}));

  return {
    chainId: baseChain.id,
    id: id.toString(),
    token,
    creator: getAddress(state[1]) as `0x${string}`,
    name,
    symbol,
    contractURI,
    description: metadata.description,
    imageURI: metadata.imageURI,
    website: metadata.website,
    twitter: metadata.twitter,
    telegram: metadata.telegram,
    discord: metadata.discord,
    status,
    raised: `${trimEth(formatEther(grossEthRaised))} ETH`,
    target: `${trimEth(formatEther(graduationEthTarget))} ETH`,
    progress: Math.min(progress, 100),
    holders: "onchain",
    volume: `${trimEth(formatEther(grossEthRaised))} ETH`,
    age: formatAge(Number(state[12])),
    risk: status === "Graduated" ? "Adminless" : "B20 gated",
    price: `${trimPriceEth(formatEther(priceEth))} ETH`,
    marketCap: `${trimEth(formatEther(fdvEth))} ETH`
  };
}

async function readLaunchState(id: bigint) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await publicClient.readContract({
      address: addresses.bondingCurveMarket!,
      abi: bondingCurveAbi,
      functionName: "launches",
      args: [id]
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function getLaunchCreatedEvent(id: bigint) {
  if (!addresses.launchFactory) return undefined;

  const latest = await publicClient.getBlockNumber();
  const chunkSize = 1900n;
  let toBlock = latest;

  while (toBlock >= addresses.deploymentBlock) {
    const fromBlock = toBlock > chunkSize && toBlock - chunkSize > addresses.deploymentBlock
      ? toBlock - chunkSize
      : addresses.deploymentBlock;
    const logs = await publicClient.getContractEvents({
      address: addresses.launchFactory,
      abi: launchFactoryAbi,
      eventName: "LaunchCreated",
      args: { launchId: id },
      fromBlock,
      toBlock
    });
    const match = logs.at(-1);
    if (match) {
      return {
        name: match.args.name || "",
        symbol: match.args.symbol || "",
        contractURI: match.args.contractURI || ""
      };
    }
    if (fromBlock === addresses.deploymentBlock) break;
    toBlock = fromBlock - 1n;
  }

  return undefined;
}

async function getLaunchCreatedEventMap(expectedCount: bigint) {
  const map = new Map<string, { name: string; symbol: string; contractURI: string }>();
  if (!addresses.launchFactory) return map;

  const latest = await publicClient.getBlockNumber();
  const chunkSize = 1900n;
  let toBlock = latest;

  while (toBlock >= addresses.deploymentBlock && BigInt(map.size) < expectedCount) {
    const fromBlock = toBlock > chunkSize && toBlock - chunkSize > addresses.deploymentBlock
      ? toBlock - chunkSize
      : addresses.deploymentBlock;
    const logs = await publicClient.getContractEvents({
      address: addresses.launchFactory,
      abi: launchFactoryAbi,
      eventName: "LaunchCreated",
      fromBlock,
      toBlock
    });

    for (const log of logs) {
      if (!log.args.launchId) continue;
      map.set(log.args.launchId.toString(), {
        name: log.args.name || "",
        symbol: log.args.symbol || "",
        contractURI: log.args.contractURI || ""
      });
    }

    if (fromBlock === addresses.deploymentBlock) break;
    toBlock = fromBlock - 1n;
  }

  return map;
}

async function getRecentOnchainTrades(id: string): Promise<DeployedTrade[]> {
  if (!addresses.bondingCurveMarket) return [];
  const latest = await publicClient.getBlockNumber();
  const lookbackBlocks = BigInt(process.env.ONCHAIN_TRADE_FALLBACK_BLOCKS || "1800");
  const fromBlock = latest > lookbackBlocks && latest - lookbackBlocks > addresses.deploymentBlock
    ? latest - lookbackBlocks
    : addresses.deploymentBlock;
  return getOnchainTradesInRange(id, fromBlock, latest);
}

async function getOnchainTradesInRange(id: string, fromBlock: bigint, toBlock: bigint): Promise<DeployedTrade[]> {
  const launchId = BigInt(id);
  const [buys, sells] = await Promise.all([
    publicClient.getContractEvents({
      address: addresses.bondingCurveMarket!,
      abi: bondingCurveAbi,
      eventName: "TokensBought",
      args: { launchId },
      fromBlock,
      toBlock
    }),
    publicClient.getContractEvents({
      address: addresses.bondingCurveMarket!,
      abi: bondingCurveAbi,
      eventName: "TokensSold",
      args: { launchId },
      fromBlock,
      toBlock
    })
  ]);

  const blockTimestamps = new Map<bigint, string>();
  const trades = [
    ...buys.map((log) => ({
      side: "buy" as const,
      trader: log.args.buyer ? getAddress(log.args.buyer) as `0x${string}` : undefined,
      ethAmount: `${trimEth(formatEther(log.args.ethIn || 0n))} ETH`,
      tokenAmount: trimEth(formatEther(log.args.tokensOut || 0n)),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      createdAt: "",
      block: log.blockNumber,
      logIndex: log.logIndex
    })),
    ...sells.map((log) => ({
      side: "sell" as const,
      trader: log.args.seller ? getAddress(log.args.seller) as `0x${string}` : undefined,
      ethAmount: `${trimEth(formatEther(log.args.ethOut || 0n))} ETH`,
      tokenAmount: trimEth(formatEther(log.args.tokensIn || 0n)),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      createdAt: "",
      block: log.blockNumber,
      logIndex: log.logIndex
    }))
  ].sort((a, b) => Number(a.block - b.block) || a.logIndex - b.logIndex);

  for (const blockNumber of new Set(trades.map((trade) => trade.block))) {
    try {
      const block = await publicClient.getBlock({ blockNumber });
      blockTimestamps.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
    } catch {
      blockTimestamps.set(blockNumber, "");
    }
  }

  return trades.map((trade) => ({
    side: trade.side,
    trader: trade.trader,
    ethAmount: trade.ethAmount,
    tokenAmount: trade.tokenAmount,
    txHash: trade.txHash,
    blockNumber: trade.blockNumber,
    createdAt: blockTimestamps.get(trade.block) || trade.createdAt
  }));
}

async function readTokenString(token: `0x${string}`, functionName: "name" | "symbol", fallback: string) {
  try {
    return await publicClient.readContract({
      address: token,
      abi: b20TokenAbi,
      functionName
    });
  } catch {
    return fallback;
  }
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
