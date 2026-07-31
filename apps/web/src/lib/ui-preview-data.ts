import type { DeployedLaunch, DeployedTrade } from "@/lib/onchain-launches";

export const UI_PREVIEW_SCOPE = "b20-ui-preview";
export const UI_PREVIEW_BLUE_TOKEN = "0xb200000000000000000000af2d07754b927109bc";

const creators = [
  "0x7a3f10000000000000000000000000000000952f",
  "0x9a771000000000000000000000000000007c4d",
  "0x1d5e100000000000000000000000000000e5f6",
  "0x2cc910000000000000000000000000000009e11",
  "0x7b4d1000000000000000000000000000004d8a",
  "0x44a2100000000000000000000000000000019b7",
  "0x991f1000000000000000000000000000005a72"
] as const;

export const uiPreviewLaunches: DeployedLaunch[] = [
  previewLaunch({
    id: "3",
    token: UI_PREVIEW_BLUE_TOKEN,
    creator: creators[0],
    name: "BLUE",
    symbol: "BLUE",
    imageURI: "/brand/bluelogo.webp",
    chainId: 8453,
    age: "2s",
    marketCap: "$2.38M",
    raised: "$452.1K",
    volume: "$1.33M",
    progress: 82,
    holders: "1.6K",
    risk: "Low risk",
    price: "$0.02131"
  }),
  previewLaunch({
    id: "4",
    token: "0xbaba00000000000000000000000000000000ba4a",
    creator: creators[1],
    name: "BARA",
    symbol: "BARA",
    imageURI: "/launch-assets/basebara.png",
    chainId: 5042,
    age: "5m",
    marketCap: "$4.27M",
    raised: "$812.4K",
    volume: "$2.11M",
    progress: 61,
    holders: "2.0K",
    risk: "Low risk",
    price: "$0.0384"
  }),
  previewLaunch({
    id: "5",
    token: "0x0e0e00000000000000000000000000000000ae90",
    creator: creators[2],
    name: "PEPO",
    symbol: "PEPO",
    imageURI: "/brand/nft-launchpad.png",
    chainId: 8453,
    age: "12m",
    marketCap: "$2.38M",
    raised: "$563.2K",
    volume: "$1.05M",
    progress: 45,
    holders: "1.2K",
    risk: "Low risk",
    price: "$0.0187"
  }),
  previewLaunch({
    id: "6",
    token: "0xb0b500000000000000000000000000000000bb55",
    creator: creators[3],
    name: "BVBS",
    symbol: "BVBS",
    chainId: 8453,
    age: "18m",
    marketCap: "$1.17M",
    raised: "$231.8K",
    volume: "$384.6K",
    progress: 28,
    holders: "884",
    risk: "Medium risk",
    price: "$0.0098"
  }),
  previewLaunch({
    id: "7",
    token: "0x5a1b000000000000000000000000000000005a5e",
    creator: creators[4],
    name: "SHIBASE",
    symbol: "SHIBASE",
    chainId: 8453,
    age: "24m",
    marketCap: "$3.91M",
    raised: "$745.3K",
    volume: "$1.88M",
    progress: 19,
    holders: "1.4K",
    risk: "Low risk",
    price: "$0.0326"
  }),
  previewLaunch({
    id: "8",
    token: "0x5a4c000000000000000000000000000000005aa4",
    creator: creators[5],
    name: "SPARK",
    symbol: "SPARK",
    chainId: 5042,
    age: "31m",
    marketCap: "$892.4K",
    raised: "$189.7K",
    volume: "$211.3K",
    progress: 11,
    holders: "706",
    risk: "Medium risk",
    price: "$0.0074"
  }),
  previewLaunch({
    id: "9",
    token: "0x1111000000000000000000000000000000001111",
    creator: creators[6],
    name: "NINI",
    symbol: "NINI",
    chainId: 8453,
    age: "42m",
    marketCap: "$673.5K",
    raised: "$142.6K",
    volume: "$178.2K",
    progress: 7,
    holders: "519",
    risk: "Low risk",
    price: "$0.0056"
  })
];

export const uiPreviewTrades: DeployedTrade[] = Array.from({ length: 54 }, (_, index) => {
  const side = index % 5 === 1 || index % 7 === 3 ? "sell" : "buy";
  const wave = Math.sin(index * .72) * .0012;
  const marketCap = 520 + index * 12 + wave * 140_000;
  const secondsAgo = (53 - index) * 310;
  return {
    side,
    source: "curve",
    trader: `0x${(0xabc000 + index * 7919).toString(16).padStart(40, "0")}` as `0x${string}`,
    ethAmount: `${(2.15 + index % 8 * .73).toFixed(2)} USDC`,
    tokenAmount: `${(95 + index * 7.35).toFixed(2)}`,
    marketCapEth: String(Math.max(420, marketCap)),
    txHash: `0x${(0x100000 + index * 104729).toString(16).padStart(64, "0")}`,
    blockNumber: String(28_000_000 + index),
    createdAt: new Date(Date.now() - secondsAgo * 1_000).toISOString()
  };
});

export function uiPreviewEnabled() {
  return process.env.B20_UI_PREVIEW === "true";
}

export function findUiPreviewLaunch(token: string) {
  return uiPreviewLaunches.find((launch) => launch.token.toLowerCase() === token.toLowerCase());
}

export function isUiPreviewLaunch(launch?: Pick<DeployedLaunch, "scope">) {
  return launch?.scope === UI_PREVIEW_SCOPE;
}

function previewLaunch(input: {
  id: string;
  token: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  imageURI?: string;
  chainId: number;
  age: string;
  marketCap: string;
  raised: string;
  volume: string;
  progress: number;
  holders: string;
  risk: string;
  price: string;
}): DeployedLaunch {
  return {
    ...input,
    scope: UI_PREVIEW_SCOPE,
    launchMode: "bond",
    contractURI: "",
    description: `${input.name} market on the B20 terminal.`,
    createdBlock: String(28_000_000 + Number(input.id)),
    status: "Live",
    target: "$1.33M",
    website: "https://b20.market"
  };
}
