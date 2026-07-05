import { formatEther } from "viem";

export const TOTAL_SUPPLY = 1_000_000_000;
export const CURVE_FEE_RATE = 0.01;

export function parseDisplayAmount(value: string) {
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (value >= 1_000) return `$${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}K`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return formatUsdPrice(value);
}

export function formatUsdPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  if (value >= 0.0001) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 12 })}`;
}

export function formatUsdFromEthText(value: string, ethUsd: number | null, isPrice = false) {
  const ethValue = parseDisplayAmount(value);
  if (!ethUsd || ethValue <= 0) return "$-";
  const usdValue = ethValue * ethUsd;
  return isPrice ? formatUsdPrice(usdValue) : compactUsd(usdValue);
}

export function formatEthAmount(value: bigint, maxFractionDigits = 6) {
  const [whole, fraction = ""] = formatEther(value).split(".");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return `${trimmed ? `${whole}.${trimmed}` : whole} ETH`;
}

export function compactTokenAmount(value: string) {
  const numeric = parseDisplayAmount(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}K`;
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function calculatePriceImpact(input: {
  mode: "buy" | "sell";
  amountIn: number;
  quotedOut: number;
  spotPriceEth: number;
}) {
  if (input.amountIn <= 0 || input.quotedOut <= 0 || input.spotPriceEth <= 0) return 0;
  if (input.mode === "buy") {
    const executionPrice = input.amountIn / input.quotedOut;
    return Math.max(0, ((executionPrice - input.spotPriceEth) / input.spotPriceEth) * 100);
  }
  const executionPrice = input.quotedOut / input.amountIn;
  return Math.max(0, ((input.spotPriceEth - executionPrice) / input.spotPriceEth) * 100);
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0.00%";
  if (value >= 100) return ">100%";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}
