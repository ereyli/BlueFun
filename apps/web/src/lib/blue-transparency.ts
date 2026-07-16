import { createPublicClient, fallback, formatUnits, getAddress, http, zeroAddress } from "viem";
import { baseChain } from "@/lib/base-chain";
import { b20TokenAbi, blueStakingAddresses, bondingCurveAbi, legacyBaseAddresses } from "@/lib/contracts";
import { baseRpcUrls } from "@/lib/rpc";

export const OFFICIAL_BLUE_TOKEN = "0xb200000000000000000000af2d07754b927109bc" as const;
export const OFFICIAL_BLUE_LAUNCH_ID = 3n;
export const BLUE_BURN_WALLET = "0x000000000000000000000000000000000000dEaD" as const;

const client = createPublicClient({
  chain: baseChain,
  transport: fallback(baseRpcUrls().map((url) => http(url, { retryCount: 0, timeout: 7_000 })), { rank: true, retryCount: 0 })
});

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export type BlueTransparencyData = {
  token: string;
  totalSupply: string;
  totalSupplyRaw: string;
  launch: {
    id: string;
    creator: string;
    factory: string;
    market: string;
    liquidityLocker: string;
    graduated: boolean;
    graduationTargetEth: string;
    initialCreatorAllocation: string;
    initialLiquidityAllocation: string;
  };
  allocations: Array<{
    id: "creator" | "staking" | "burn" | "holders";
    label: string;
    description: string;
    address?: string;
    balance: string;
    rawBalance: string;
    percent: number;
    color: string;
  }>;
};

export async function getBlueTransparency(): Promise<BlueTransparencyData> {
  const [totalSupply, launch] = await Promise.all([
    client.readContract({ address: OFFICIAL_BLUE_TOKEN, abi: b20TokenAbi, functionName: "totalSupply" }),
    client.readContract({
      address: legacyBaseAddresses.bondingCurveMarket,
      abi: bondingCurveAbi,
      functionName: "launches",
      args: [OFFICIAL_BLUE_LAUNCH_ID]
    })
  ]);

  const creator = getAddress(launch[1]);
  const [creatorBalance, stakingBalance, burnBalance] = await Promise.all([
    client.readContract({
      address: OFFICIAL_BLUE_TOKEN,
      abi: b20TokenAbi,
      functionName: "balanceOf",
      args: [creator]
    }),
    client.readContract({
      address: OFFICIAL_BLUE_TOKEN,
      abi: b20TokenAbi,
      functionName: "balanceOf",
      args: [blueStakingAddresses.vault]
    }),
    client.readContract({
      address: OFFICIAL_BLUE_TOKEN,
      abi: b20TokenAbi,
      functionName: "balanceOf",
      args: [BLUE_BURN_WALLET]
    })
  ]);
  const holderBalance = totalSupply - creatorBalance - stakingBalance - burnBalance;
  const share = (amount: bigint) => totalSupply === 0n ? 0 : Number(((amount * 10_000n) / totalSupply)) / 100;

  return {
    token: OFFICIAL_BLUE_TOKEN,
    totalSupply: formatUnits(totalSupply, 18),
    totalSupplyRaw: totalSupply.toString(),
    launch: {
      id: OFFICIAL_BLUE_LAUNCH_ID.toString(),
      creator,
      factory: legacyBaseAddresses.launchFactory,
      market: legacyBaseAddresses.bondingCurveMarket,
      liquidityLocker: legacyBaseAddresses.liquidityLocker,
      graduated: launch[16],
      graduationTargetEth: formatUnits(launch[6], 18),
      initialCreatorAllocation: formatUnits(launch[9], 18),
      initialLiquidityAllocation: formatUnits(totalSupply - launch[9], 18)
    },
    allocations: [
      {
        id: "creator",
        label: "Creator wallet",
        description: "Live balance of the onchain launch creator.",
        address: creator,
        balance: formatUnits(creatorBalance, 18),
        rawBalance: creatorBalance.toString(),
        percent: share(creatorBalance),
        color: "#6f8fff"
      },
      {
        id: "staking",
        label: "Staked BLUE",
        description: "BLUE currently held by the staking vault, read live onchain.",
        address: blueStakingAddresses.vault,
        balance: formatUnits(stakingBalance, 18),
        rawBalance: stakingBalance.toString(),
        percent: share(stakingBalance),
        color: "#38c993"
      },
      {
        id: "burn",
        label: "Burn wallet",
        description: "BLUE sent to the standard dead address, read live onchain.",
        address: BLUE_BURN_WALLET,
        balance: formatUnits(burnBalance, 18),
        rawBalance: burnBalance.toString(),
        percent: share(burnBalance),
        color: "#ff9b6a"
      },
      {
        id: "holders",
        label: "Other wallets",
        description: "Supply outside the disclosed creator, staking and burn wallets. Includes LP custody and holders.",
        balance: formatUnits(holderBalance < 0n ? 0n : holderBalance, 18),
        rawBalance: (holderBalance < 0n ? 0n : holderBalance).toString(),
        percent: share(holderBalance < 0n ? 0n : holderBalance),
        color: "#38d7ca"
      }
    ]
  };
}

export function blueExplorerUrl(address: string) {
  return `https://basescan.org/address/${address}`;
}

export function blueAddressLabel(address: string) {
  return address === zeroAddress ? "—" : shortAddress(address);
}
