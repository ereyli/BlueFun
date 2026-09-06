#!/usr/bin/env node
import { encodeFunctionData, getAddress, stringToHex, zeroAddress } from "viem";
import { readFile } from "node:fs/promises";

const tickerBytes32 = (value) => stringToHex(value, { size: 32 });

const chainId = Number(process.argv.find((value) => value.startsWith("--chain="))?.split("=")[1] || "0");
const registry = process.argv.find((value) => value.startsWith("--registry="))?.split("=")[1];
if (![8453, 4663].includes(chainId) || !registry || !/^0x[a-fA-F0-9]{40}$/.test(registry)) {
  throw new Error("Usage: npm run stocks:plan -- --chain=8453|4663 --registry=0x...");
}

const abi = [{
  type: "function", name: "configureAssets", stateMutability: "nonpayable",
  inputs: [{ name: "configs", type: "tuple[]", components: [
    { name: "token", type: "address" }, { name: "priceFeed", type: "address" },
    { name: "ticker", type: "bytes32" }, { name: "maxStaleness", type: "uint32" },
    { name: "tokenDecimals", type: "uint8" }, { name: "checkOraclePause", type: "bool" },
    { name: "checkTransferPause", type: "bool" },
    { name: "useAttestedPrice", type: "bool" }, { name: "enabled", type: "bool" }
  ] }], outputs: []
}];

const base = JSON.parse(await readFile(new URL("../config/stock-assets.base.json", import.meta.url), "utf8"));

async function robinhoodConfigs() {
  const [assetResponse, feedResponse] = await Promise.all([
    fetch("https://api.robinhood.com/rhj/assets"),
    fetch("https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json")
  ]);
  if (!assetResponse.ok || !feedResponse.ok) throw new Error("Official Robinhood/Chainlink catalog unavailable");
  const assets = (await assetResponse.json()).assets || [];
  const feeds = await feedResponse.json();
  const feedBySymbol = new Map(feeds.flatMap((feed) => {
    const symbol = feed.name?.match(/^Robinhood\s+(.+?)(?:\s*\/\s*|-)USD$/i)?.[1]?.trim().toUpperCase();
    return symbol && /^0x[a-fA-F0-9]{40}$/.test(feed.proxyAddress || "") ? [[symbol, feed.proxyAddress]] : [];
  }));
  return assets.flatMap((asset) => {
    const deployment = asset.deployments?.find((item) => item.chainId === 4663);
    const symbol = asset.tokenSymbol?.trim().toUpperCase();
    if (asset.status !== "ASSET_STATUS_ACTIVE" || asset.tokenDecimals !== 18 || !symbol || !deployment) return [];
    const priceFeed = feedBySymbol.get(symbol);
    return [{
      token: getAddress(deployment.contractAddress), priceFeed: priceFeed ? getAddress(priceFeed) : zeroAddress,
      ticker: tickerBytes32(symbol), maxStaleness: 345600, tokenDecimals: 18,
      checkOraclePause: Boolean(priceFeed), checkTransferPause: false, useAttestedPrice: !priceFeed, enabled: true
    }];
  }).sort((a, b) => a.token.localeCompare(b.token));
}

const configs = chainId === 8453
  ? base.map(({ symbol, token, priceFeed }) => ({
      token: getAddress(token), priceFeed: getAddress(priceFeed), ticker: tickerBytes32(symbol),
      maxStaleness: 345600, tokenDecimals: 18, checkOraclePause: false, checkTransferPause: true,
      useAttestedPrice: false, enabled: true
    }))
  : await robinhoodConfigs();
const chunks = [];
for (let index = 0; index < configs.length; index += 25) {
  const batch = configs.slice(index, index + 25);
  chunks.push({
    to: getAddress(registry),
    data: encodeFunctionData({ abi, functionName: "configureAssets", args: [batch] }),
    assets: batch.map((item) => ({ token: item.token, ticker: item.ticker, mode: item.useAttestedPrice ? "attested" : "chainlink" }))
  });
}
console.log(JSON.stringify({ chainId, registry: getAddress(registry), assetCount: configs.length, transactionCount: chunks.length, transactions: chunks }, null, 2));
