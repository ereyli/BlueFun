import { createPublicClient, formatEther, getAddress, http, zeroAddress } from "viem";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { b20TokenAbi, bondingCurveAbi, launchFactoryAbi, robinhoodAddresses } from "@/lib/contracts";
import { readTokenMetadata } from "@/lib/token-metadata";
import type { DeployedLaunch } from "@/lib/onchain-launches";

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com")
});

export async function getRobinhoodLaunches(): Promise<DeployedLaunch[]> {
  if (!robinhoodAddresses.bondingCurveMarket || !robinhoodAddresses.launchFactory) return [];
  const count = await client.readContract({ address: robinhoodAddresses.bondingCurveMarket, abi: bondingCurveAbi, functionName: "launchCount" });
  const results = await Promise.allSettled(Array.from({ length: Number(count) }, (_, i) => getRobinhoodLaunch(String(i + 1))));
  return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []).sort((a, b) => Number(b.id) - Number(a.id));
}

export async function getRobinhoodLaunch(id: string): Promise<DeployedLaunch | undefined> {
  const market = robinhoodAddresses.bondingCurveMarket;
  const factory = robinhoodAddresses.launchFactory;
  if (!market || !factory) return undefined;
  const launchId = BigInt(id);
  const state = await client.readContract({ address: market, abi: bondingCurveAbi, functionName: "launches", args: [launchId] });
  const token = getAddress(state[0]) as `0x${string}`;
  if (token === zeroAddress) return undefined;

  const logs = await client.getContractEvents({
    address: factory,
    abi: launchFactoryAbi,
    eventName: "LaunchCreated",
    args: { launchId },
    fromBlock: robinhoodAddresses.deploymentBlock,
    toBlock: "latest"
  });
  const event = logs.at(-1)?.args;
  const [tokenName, tokenSymbol] = await Promise.all([
    event?.name || client.readContract({ address: token, abi: b20TokenAbi, functionName: "name" }),
    event?.symbol || client.readContract({ address: token, abi: b20TokenAbi, functionName: "symbol" })
  ]);
  const metadata = await readTokenMetadata(event?.contractURI || "").catch(() => ({}));
  const raised = state[5];
  const target = state[6];
  const maxSupply = state[7];
  const fdv = state[2] === 0n ? 0n : (state[3] * maxSupply) / state[2];
  const price = state[2] === 0n ? 0n : (state[3] * 10n ** 18n) / state[2];
  const progress = target === 0n ? 0 : Number((raised * 100n) / target);
  const status: DeployedLaunch["status"] = state[16] ? "Graduated" : state[15] ? "Ready" : "Live";
  return {
    chainId: robinhoodChain.id,
    id,
    token,
    creator: getAddress(state[1]) as `0x${string}`,
    name: String(tokenName),
    symbol: String(tokenSymbol),
    contractURI: event?.contractURI || "",
    ...metadata,
    status,
    raised: `${trim(formatEther(raised))} ETH`,
    target: `${trim(formatEther(target))} ETH`,
    progress: Math.min(progress, 100),
    holders: "onchain",
    volume: `${trim(formatEther(raised))} ETH`,
    age: formatAge(Number(state[12])),
    risk: status === "Graduated" ? "Adminless" : "Fixed-supply ERC-20",
    price: `${trim(formatEther(price), 12)} ETH`,
    marketCap: `${trim(formatEther(fdv))} ETH`
  };
}

function trim(value: string, digits = 4) {
  const [whole, fraction = ""] = value.split(".");
  const clean = fraction.slice(0, digits).replace(/0+$/, "");
  return clean ? `${whole}.${clean}` : whole;
}

function formatAge(createdAt: number) {
  const seconds = Math.max(1, Math.floor(Date.now() / 1000) - createdAt);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
