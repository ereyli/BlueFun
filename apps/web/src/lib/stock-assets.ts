export type StockPriceMode = "chainlink" | "attested";

export type StockAsset = {
  chainId: 8453 | 4663;
  token: `0x${string}`;
  symbol: string;
  name: string;
  logoUrl?: string;
  priceFeed?: `0x${string}`;
  priceMode: StockPriceMode;
  tokenDecimals: 18;
  status: "active";
};

const BASE_STOCKS: StockAsset[] = baseStockCatalog.map(({ symbol, name, token, priceFeed }) => ({
  chainId: 8453,
  symbol,
  name,
  token: token as `0x${string}`,
  priceFeed: priceFeed as `0x${string}`,
  priceMode: "chainlink",
  tokenDecimals: 18,
  status: "active"
}));

type RobinhoodAssetResponse = {
  assets?: Array<{
    tokenSymbol?: string;
    tokenName?: string;
    status?: string;
    tokenDecimals?: number;
    logoUrl?: string;
    deployments?: Array<{ chainId?: number; contractAddress?: string }>;
  }>;
};

type ChainlinkFeed = { name?: string; proxyAddress?: string };

function robinhoodFeedSymbol(name = "") {
  const match = name.match(/^Robinhood\s+(.+?)(?:\s*\/\s*|-)USD$/i);
  return match?.[1]?.trim().toUpperCase();
}

export function getBaseStockAssets() {
  return BASE_STOCKS;
}

export async function getRobinhoodStockAssets(): Promise<StockAsset[]> {
  const [assetsResponse, feedsResponse] = await Promise.all([
    fetch("https://api.robinhood.com/rhj/assets", { next: { revalidate: 300 } }),
    fetch("https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json", { next: { revalidate: 3600 } })
  ]);
  if (!assetsResponse.ok) throw new Error(`Robinhood asset registry returned ${assetsResponse.status}`);
  if (!feedsResponse.ok) throw new Error(`Chainlink feed registry returned ${feedsResponse.status}`);
  const assets = (await assetsResponse.json()) as RobinhoodAssetResponse;
  const feeds = (await feedsResponse.json()) as ChainlinkFeed[];
  const feedBySymbol = new Map<string, `0x${string}`>();
  for (const feed of feeds) {
    const symbol = robinhoodFeedSymbol(feed.name);
    if (symbol && /^0x[a-fA-F0-9]{40}$/.test(feed.proxyAddress || "")) {
      feedBySymbol.set(symbol, feed.proxyAddress as `0x${string}`);
    }
  }
  return (assets.assets || []).flatMap((asset): StockAsset[] => {
    const deployment = asset.deployments?.find((item) => item.chainId === 4663);
    const symbol = asset.tokenSymbol?.trim().toUpperCase();
    if (
      asset.status !== "ASSET_STATUS_ACTIVE" || asset.tokenDecimals !== 18 || !symbol
      || !deployment || !/^0x[a-fA-F0-9]{40}$/.test(deployment.contractAddress || "")
    ) return [];
    const priceFeed = feedBySymbol.get(symbol);
    return [{
      chainId: 4663,
      token: deployment.contractAddress as `0x${string}`,
      symbol,
      name: asset.tokenName?.replace(/\s*•\s*Robinhood Token$/i, "") || symbol,
      logoUrl: asset.logoUrl,
      priceFeed,
      priceMode: priceFeed ? "chainlink" : "attested",
      tokenDecimals: 18,
      status: "active"
    }];
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function getStockAssets(chainId: number) {
  if (chainId === 8453) return getBaseStockAssets();
  if (chainId === 4663) return getRobinhoodStockAssets();
  return [];
}
import baseStockCatalog from "../../../../config/stock-assets.base.json";
