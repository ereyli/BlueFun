import { getAddress, isAddress, zeroAddress, type Address } from "viem";

export type BlueDexToken = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  native?: boolean;
  custom?: boolean;
  placeholder?: boolean;
};

export type BlueDexDeployment = {
  chainId: 8453 | 4663;
  factory: Address;
  router: Address;
  wrappedNative: Address;
  explorer: string;
  tokens: BlueDexToken[];
};

const ETH: BlueDexToken = {
  address: zeroAddress,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true,
  logo: "/tokens/eth.svg"
};

export const BLUEDEX_DEPLOYMENTS: Record<8453 | 4663, BlueDexDeployment> = {
  8453: {
    chainId: 8453,
    factory: "0xDc4fd3381a67F40e6CF8B54f4b33C1ddddc5f69C",
    router: "0x1B4DFD836CF75E427BA49715606F25bdCbAF5431",
    wrappedNative: "0x4200000000000000000000000000000000000006",
    explorer: "https://basescan.org",
    tokens: [
      ETH,
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logo: "/tokens/eth.svg" },
      { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, logo: "/tokens/usdc.svg" },
      { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", symbol: "USDbC", name: "USD Base Coin", decimals: 6, logo: "/tokens/usdc.svg" },
      { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", name: "Coinbase Wrapped BTC", decimals: 8, logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf/logo.png" },
      { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0dec22", symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", decimals: 18, logo: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0dec22/logo.png" },
      { address: "0xb200000000000000000000Af2d07754b927109bc", symbol: "BLUE", name: "Blue", decimals: 18, logo: "/brand/bluelogo.webp" }
    ]
  },
  4663: {
    chainId: 4663,
    factory: "0x9A5786CAd9845dc83537cf7420D707179322FC3E",
    router: "0xd2541D19f560F234754b9Cc4a688Ac4f30b35B77",
    wrappedNative: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    explorer: "https://robinhoodchain.blockscout.com",
    tokens: [
      ETH,
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH", name: "Wrapped Ether", decimals: 18, logo: "/tokens/eth.svg" }
    ]
  }
};

export const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

export const factoryAbi = [
  { type: "function", name: "getPair", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "allPairsLength", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allPairs", stateMutability: "view", inputs: [{ name: "index", type: "uint256" }], outputs: [{ type: "address" }] }
] as const;

export const pairAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

export const routerAbi = [
  { type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "path", type: "address[]" }], outputs: [{ name: "amounts", type: "uint256[]" }] },
  { type: "function", name: "swapExactETHForTokensSupportingFeeOnTransferTokens", stateMutability: "payable", inputs: [{ name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [] },
  { type: "function", name: "swapExactTokensForETHSupportingFeeOnTransferTokens", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [] },
  { type: "function", name: "swapExactTokensForTokensSupportingFeeOnTransferTokens", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [] },
  { type: "function", name: "addLiquidity", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "amountADesired", type: "uint256" }, { name: "amountBDesired", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "addLiquidityETH", stateMutability: "payable", inputs: [{ name: "token", type: "address" }, { name: "amountTokenDesired", type: "uint256" }, { name: "amountTokenMin", type: "uint256" }, { name: "amountETHMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "removeLiquidity", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "liquidity", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "removeLiquidityETHSupportingFeeOnTransferTokens", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "liquidity", type: "uint256" }, { name: "amountTokenMin", type: "uint256" }, { name: "amountETHMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ type: "uint256" }] }
] as const;

export function blueDexDeployment(chainId: number) {
  return BLUEDEX_DEPLOYMENTS[chainId === 4663 ? 4663 : 8453];
}

export function wrappedAddress(token: BlueDexToken, deployment: BlueDexDeployment) {
  return token.native ? deployment.wrappedNative : token.address;
}

export function tokenKey(token: BlueDexToken) {
  return token.native ? "native" : token.address.toLowerCase();
}

export function sameToken(a: BlueDexToken, b: BlueDexToken, deployment: BlueDexDeployment) {
  return wrappedAddress(a, deployment).toLowerCase() === wrappedAddress(b, deployment).toLowerCase();
}

export function normalizeImportedToken(input: Partial<BlueDexToken>): BlueDexToken | undefined {
  if (!input.address || !isAddress(input.address) || input.address === zeroAddress) return undefined;
  const symbol = String(input.symbol || "").trim().slice(0, 16);
  const name = String(input.name || symbol).trim().slice(0, 64);
  const decimals = Number(input.decimals);
  if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;
  const logo = typeof input.logo === "string" && (input.logo.startsWith("/") || input.logo.startsWith("https://")) ? input.logo.slice(0, 500) : undefined;
  return { address: getAddress(input.address), symbol, name, decimals, custom: true, logo };
}

export function customTokenStorageKey(chainId: number) {
  return `bluefun:bluedex:tokens:${chainId}`;
}

export function tokenLogoUrl(chainId: number, address: string) {
  return `/api/token-logo?chainId=${chainId}&address=${encodeURIComponent(address)}`;
}

export function applySlippage(value: bigint, slippageBps: number) {
  const safeBps = BigInt(Math.max(0, Math.min(5_000, Math.round(slippageBps))));
  return value * (10_000n - safeBps) / 10_000n;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function candidatePaths(tokenIn: BlueDexToken, tokenOut: BlueDexToken, deployment: BlueDexDeployment) {
  const input = wrappedAddress(tokenIn, deployment);
  const output = wrappedAddress(tokenOut, deployment);
  const direct = [input, output] as Address[];
  if (input.toLowerCase() === deployment.wrappedNative.toLowerCase() || output.toLowerCase() === deployment.wrappedNative.toLowerCase()) return [direct];
  return [direct, [input, deployment.wrappedNative, output] as Address[]];
}

export function priceImpactBps(amountIn: bigint, amountOut: bigint, reserveIn?: bigint, reserveOut?: bigint) {
  if (!reserveIn || !reserveOut || amountIn <= 0n || amountOut <= 0n) return undefined;
  const spotScaled = reserveOut * 10n ** 18n / reserveIn;
  const executionScaled = amountOut * 10n ** 18n / amountIn;
  if (executionScaled >= spotScaled) return 0;
  return Number((spotScaled - executionScaled) * 10_000n / spotScaled);
}
