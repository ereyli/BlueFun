import { createPublicClient, formatEther, getAddress, http, zeroAddress } from "viem";
import { baseSepoliaChain } from "@/lib/base-sepolia-chain";
import { addresses, b20TokenAbi, bondingCurveAbi, launchFactoryAbi } from "@/lib/contracts";
import { getDbLaunches } from "@/lib/db-launches";
import { readTokenMetadata, type TokenMetadata } from "@/lib/token-metadata";

export type DeployedLaunch = {
  id: string;
  token: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  contractURI: string;
  imageURI?: string;
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
  trader?: `0x${string}`;
  ethAmount: string;
  tokenAmount: string;
  marketCapEth?: string;
  txHash: string;
  blockNumber: string;
  createdAt: string;
};

const publicClient = createPublicClient({
  chain: baseSepoliaChain,
  transport: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org")
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
    const dbLaunches = await getDbLaunches().catch(() => undefined);
    const dbLaunch = dbLaunches?.find((launch) => launch.id === id);
    if (dbLaunch || !onchainFallbackEnabled()) return dbLaunch;
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

  const realEthReserve = state[4];
  const graduationEthTarget = state[5];
  const maxSupply = state[6];
  const virtualTokenReserve = state[2];
  const virtualEthReserve = state[3];
  const fdvEth = virtualTokenReserve === 0n ? 0n : (virtualEthReserve * maxSupply) / virtualTokenReserve;
  const priceEth = virtualTokenReserve === 0n ? 0n : (virtualEthReserve * 1_000_000_000_000_000_000n) / virtualTokenReserve;
  const progress = graduationEthTarget === 0n ? 0 : Number((realEthReserve * 100n) / graduationEthTarget);
  const status: DeployedLaunch["status"] = state[15] ? "Graduated" : state[14] ? "Ready" : "Live";
  const contractURI = launchEvent?.contractURI || "";
  const metadata = await readTokenMetadata(contractURI).catch((): TokenMetadata => ({}));

  return {
    id: id.toString(),
    token,
    creator: getAddress(state[1]) as `0x${string}`,
    name,
    symbol,
    contractURI,
    imageURI: metadata.imageURI,
    status,
    raised: `${trimEth(formatEther(realEthReserve))} ETH`,
    target: `${trimEth(formatEther(graduationEthTarget))} ETH`,
    progress: Math.min(progress, 100),
    holders: "onchain",
    volume: `${trimEth(formatEther(realEthReserve))} ETH`,
    age: formatAge(Number(state[11])),
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

async function getOnchainTrades(id: string): Promise<DeployedTrade[]> {
  if (!addresses.bondingCurveMarket) return [];
  const launchId = BigInt(id);
  const latest = await publicClient.getBlockNumber();
  const chunkSize = 1900n;
  let toBlock = latest;
  const trades: Array<DeployedTrade & {
    block: bigint;
    logIndex: number;
    grossEth: bigint;
    netEth: bigint;
    tokenDelta: bigint;
  }> = [];
  const blockTimestamps = new Map<bigint, string>();

  while (toBlock >= addresses.deploymentBlock) {
    const fromBlock = toBlock > chunkSize && toBlock - chunkSize > addresses.deploymentBlock
      ? toBlock - chunkSize
      : addresses.deploymentBlock;

    const [buys, sells] = await Promise.all([
      publicClient.getContractEvents({
        address: addresses.bondingCurveMarket,
        abi: bondingCurveAbi,
        eventName: "TokensBought",
        args: { launchId },
        fromBlock,
        toBlock
      }),
      publicClient.getContractEvents({
        address: addresses.bondingCurveMarket,
        abi: bondingCurveAbi,
        eventName: "TokensSold",
        args: { launchId },
        fromBlock,
        toBlock
      })
    ]);

    for (const log of buys) {
      const grossEth = log.args.ethIn || 0n;
      const netEth = grossEth - (log.args.platformFee || 0n) - (log.args.creatorFee || 0n);
      trades.push({
        side: "buy",
        trader: log.args.buyer ? getAddress(log.args.buyer) as `0x${string}` : undefined,
        ethAmount: `${trimEth(formatEther(grossEth))} ETH`,
        tokenAmount: trimEth(formatEther(log.args.tokensOut || 0n)),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        createdAt: "",
        block: log.blockNumber,
        logIndex: log.logIndex,
        grossEth,
        netEth,
        tokenDelta: log.args.tokensOut || 0n
      });
    }

    for (const log of sells) {
      const netEth = log.args.ethOut || 0n;
      const grossEth = netEth + (log.args.platformFee || 0n) + (log.args.creatorFee || 0n);
      trades.push({
        side: "sell",
        trader: log.args.seller ? getAddress(log.args.seller) as `0x${string}` : undefined,
        ethAmount: `${trimEth(formatEther(log.args.ethOut || 0n))} ETH`,
        tokenAmount: trimEth(formatEther(log.args.tokensIn || 0n)),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        createdAt: "",
        block: log.blockNumber,
        logIndex: log.logIndex,
        grossEth,
        netEth,
        tokenDelta: log.args.tokensIn || 0n
      });
    }

    if (fromBlock === addresses.deploymentBlock) break;
    toBlock = fromBlock - 1n;
  }

  for (const blockNumber of new Set(trades.map((trade) => trade.block))) {
    try {
      const block = await publicClient.getBlock({ blockNumber });
      blockTimestamps.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
    } catch {
      blockTimestamps.set(blockNumber, "");
    }
  }

  let virtualTokenReserve = 1_000_000_000n * 1_000_000_000_000_000_000n;
  let virtualEthReserve = 1_250_000_000_000_000_000n;
  const maxSupply = 1_000_000_000n * 1_000_000_000_000_000_000n;

  return trades
    .sort((a, b) => Number(a.block - b.block) || a.logIndex - b.logIndex)
    .map(({ block, logIndex, grossEth, netEth, tokenDelta, ...trade }) => {
      if (trade.side === "buy") {
        virtualEthReserve += netEth;
        virtualTokenReserve = virtualTokenReserve > tokenDelta ? virtualTokenReserve - tokenDelta : 1n;
      } else {
        virtualEthReserve = virtualEthReserve > grossEth ? virtualEthReserve - grossEth : 1n;
        virtualTokenReserve += tokenDelta;
      }
      const marketCapWei = virtualTokenReserve === 0n ? 0n : (virtualEthReserve * maxSupply) / virtualTokenReserve;
      return {
      ...trade,
      marketCapEth: formatEther(marketCapWei),
      createdAt: blockTimestamps.get(block) || trade.createdAt
      };
    });
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

  return trades.map(({ block, logIndex, ...trade }) => ({
    ...trade,
    createdAt: blockTimestamps.get(block) || trade.createdAt
  }));
}

function mergeTrades(dbTrades: DeployedTrade[], onchainTrades: DeployedTrade[]) {
  const merged = new Map<string, DeployedTrade>();
  for (const trade of dbTrades) {
    merged.set(`${trade.txHash}:${trade.side}:${trade.tokenAmount}`, trade);
  }
  for (const trade of onchainTrades) {
    merged.set(`${trade.txHash}:${trade.side}:${trade.tokenAmount}`, trade);
  }
  return Array.from(merged.values()).sort((a, b) => {
    const blockDiff = Number(BigInt(a.blockNumber || "0") - BigInt(b.blockNumber || "0"));
    if (blockDiff !== 0) return blockDiff;
    return Date.parse(a.createdAt || "0") - Date.parse(b.createdAt || "0");
  });
}

function mergeLaunches(dbLaunches: DeployedLaunch[], onchainLaunches: DeployedLaunch[]) {
  const merged = new Map<string, DeployedLaunch>();

  for (const launch of dbLaunches) {
    merged.set(launch.id, launch);
  }

  for (const launch of onchainLaunches) {
    const indexed = merged.get(launch.id);
    merged.set(launch.id, {
      ...indexed,
      ...launch,
      contractURI: launch.contractURI || indexed?.contractURI || "",
      imageURI: launch.imageURI || indexed?.imageURI
    });
  }

  return Array.from(merged.values()).sort((a, b) => Number(b.id) - Number(a.id));
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
