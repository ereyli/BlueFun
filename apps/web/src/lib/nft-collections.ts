import { createPublicClient, formatEther, getAddress, http, zeroAddress } from "viem";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { baseChain } from "@/lib/base-chain";
import { baseRpcUrls } from "@/lib/rpc";
import { blueEditionAbi, bluePFPAbi, nftAddresses, nftCollectionFactoryAbi, nftDeploymentForFactory, nftDropControllerAbi, nftLaunchpadEnabled, nftPFPFactoryAbi, type NFTDeployment } from "@/lib/nft-contracts";
import { optimizedTokenImageUrl, readTokenMetadata } from "@/lib/token-metadata";

export type NFTCollectionSummary = {
  id: string;
  address: `0x${string}`;
  creator: `0x${string}`;
  factory: `0x${string}`;
  deployment: NFTDeployment;
  name: string;
  symbol: string;
  imageUrl?: string;
  description?: string;
  itemCount: number;
  initialSupply: string;
  initialMinted: string;
  royaltyPercent: string;
  phaseId: string;
  mintPriceEth?: string;
  access: "Public" | "Allowlist" | "Not configured";
  status: "Live" | "Upcoming" | "Ended" | "Draft";
  isFree: boolean;
  standard: "ERC-1155" | "ERC-721 PFP";
};

const clients = baseRpcUrls().map((url) => createPublicClient({
  chain: baseChain,
  transport: http(url, { retryCount: 0, timeout: 7_000 })
}));

type NFTClient = (typeof clients)[number];

async function loadNFTCollections(limit = 60): Promise<NFTCollectionSummary[]> {
  if (!nftLaunchpadEnabled) return [];
  const indexed = await loadIndexedCollections(limit);
  if (indexed) return indexed;
  let lastError: unknown;
  for (const client of clients) {
    try {
      return await loadOnchainCollections(client, limit);
    } catch (error) {
      lastError = error;
    }
  }
  console.error("Failed to load NFT collections from every configured Base RPC", lastError);
  return [];
}

async function loadOnchainCollections(client: NFTClient, limit: number): Promise<NFTCollectionSummary[]> {
    const code = await client.getBytecode({ address: nftAddresses.collectionFactory });
    if (!code || code === "0x") throw new Error("NFT collection factory is not deployed on this RPC network");
    const [count, pfpCount] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: nftAddresses.collectionFactory, abi: nftCollectionFactoryAbi, functionName: "collectionCount" },
        { address: nftAddresses.pfpFactory, abi: nftPFPFactoryAbi, functionName: "collectionCount" }
      ]
    });
    const total = Number(count > BigInt(limit) ? BigInt(limit) : count);
    const firstId = count - BigInt(total) + 1n;
    const ids = Array.from({ length: total }, (_, index) => firstId + BigInt(index)).reverse();
    const editionAddressResults = ids.length ? await client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: nftAddresses.collectionFactory, abi: nftCollectionFactoryAbi, functionName: "collections" as const, args: [id] }))
    }) : [];
    const addresses = ids.map((id, index) => ({ id, address: getAddress(editionAddressResults[index]) }));
    const editions = (await Promise.all(addresses.map(({ id, address }) => loadCollection(client, id, address)))).filter((value): value is NFTCollectionSummary => Boolean(value));
    if (editions.length !== addresses.length) throw new Error("RPC failed while reading one or more edition collections");
    if (nftAddresses.pfpFactory === zeroAddress) return editions;
    const pfpTotal = Number(pfpCount > BigInt(limit) ? BigInt(limit) : pfpCount);
    const pfpFirstId = pfpCount - BigInt(pfpTotal) + 1n;
    const pfpIds = Array.from({ length: pfpTotal }, (_, index) => pfpFirstId + BigInt(index)).reverse();
    const pfpAddressResults = pfpIds.length ? await client.multicall({
      allowFailure: false,
      contracts: pfpIds.map((id) => ({ address: nftAddresses.pfpFactory, abi: nftPFPFactoryAbi, functionName: "collections" as const, args: [id] }))
    }) : [];
    const pfpAddresses = pfpIds.map((id, index) => ({ id, address: getAddress(pfpAddressResults[index]) }));
    const pfps = (await Promise.all(pfpAddresses.map(({ id, address }) => loadPFPCollection(client, id, address)))).filter((value): value is NFTCollectionSummary => Boolean(value));
    if (pfps.length !== pfpAddresses.length) throw new Error("RPC failed while reading one or more PFP collections");
    return [...pfps, ...editions].slice(0, limit);
}

async function loadIndexedCollections(limit: number): Promise<NFTCollectionSummary[] | undefined> {
  if (process.env.POSTGRES_INDEXER_ENABLED !== "true") return undefined;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return undefined;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const collectionsResponse = await supabase.from("nft_collections")
      .select("collection_id,collection,creator,factory,name,symbol,standard,contract_uri,initial_max_supply,royalty_bps,created_block")
      .eq("chain_id", 8453)
      .in("factory", [nftAddresses.collectionFactory.toLowerCase(), nftAddresses.pfpFactory.toLowerCase()])
      .order("created_block", { ascending: false })
      .limit(limit);
    if (collectionsResponse.error) throw collectionsResponse.error;
    const rows = (collectionsResponse.data || []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];
    const addresses = rows.map((row) => String(row.collection).toLowerCase());
    const [itemsResponse, phasesResponse] = await Promise.all([
      supabase.from("nft_items").select("collection,token_id,max_supply,lifetime_minted").eq("chain_id", 8453).eq("token_id", 1).in("collection", addresses),
      supabase.from("nft_mint_phases").select("collection,phase_id,phase_type,mint_price,start_time,end_time,cancelled").eq("chain_id", 8453).eq("token_id", 1).in("collection", addresses).order("phase_id", { ascending: false })
    ]);
    if (itemsResponse.error) throw itemsResponse.error;
    if (phasesResponse.error) throw phasesResponse.error;
    const items = new Map((itemsResponse.data || []).map((row) => [String(row.collection).toLowerCase(), row]));
    const phases = new Map<string, Record<string, unknown>>();
    for (const row of (phasesResponse.data || []) as Array<Record<string, unknown>>) {
      const collection = String(row.collection).toLowerCase();
      if (!phases.has(collection)) phases.set(collection, row);
    }
    const mapped = await Promise.all(rows.map(async (row): Promise<NFTCollectionSummary | undefined> => {
      try {
        const address = getAddress(String(row.collection));
        const factory = getAddress(String(row.factory));
        const keyAddress = address.toLowerCase();
        const item = items.get(keyAddress);
        const phase = phases.get(keyAddress);
        const metadata = await readTokenMetadata(String(row.contract_uri || ""));
        const phaseId = String(phase?.phase_id || "0");
        const now = Math.floor(Date.now() / 1000);
        const cancelled = Boolean(phase?.cancelled);
        const start = Number(phase?.start_time || 0);
        const end = Number(phase?.end_time || 0);
        const access: NFTCollectionSummary["access"] = !phase ? "Not configured" : Number(phase.phase_type) === 1 ? "Allowlist" : "Public";
        const status: NFTCollectionSummary["status"] = !phase ? "Draft" : cancelled || now >= end ? "Ended" : now < start ? "Upcoming" : "Live";
        const mintPrice = BigInt(String(phase?.mint_price || "0"));
        const standard = String(row.standard) === "ERC721" ? "ERC-721 PFP" : "ERC-1155";
        return {
          id: standard === "ERC-721 PFP" ? `P${String(row.collection_id)}` : String(row.collection_id),
          address,
          creator: getAddress(String(row.creator)),
          factory,
          deployment: nftDeploymentForFactory(factory),
          name: String(row.name),
          symbol: String(row.symbol),
          imageUrl: metadata.imageURI ? optimizedTokenImageUrl(metadata.imageURI) : undefined,
          description: metadata.description,
          itemCount: standard === "ERC-721 PFP" ? Number(row.initial_max_supply || 0) : 1,
          initialSupply: String(item?.max_supply || row.initial_max_supply || "0"),
          initialMinted: String(item?.lifetime_minted || "0"),
          royaltyPercent: (Number(row.royalty_bps || 0) / 100).toFixed(Number(row.royalty_bps || 0) % 100 ? 2 : 0),
          phaseId,
          mintPriceEth: access === "Public" && phase ? formatEther(mintPrice) : undefined,
          access,
          status,
          isFree: access === "Public" && phaseId !== "0" && mintPrice === 0n,
          standard
        };
      } catch {
        return undefined;
      }
    }));
    return mapped.filter((value): value is NFTCollectionSummary => Boolean(value));
  } catch (error) {
    console.error("Failed to load indexed NFT collections", error);
    return undefined;
  }
}

export const getNFTCollections = unstable_cache(loadNFTCollections, ["bluefun-nft-collections-v4"], {
  revalidate: 30,
  tags: ["nft-collections"]
});

async function loadCollection(client: NFTClient, id: bigint, address: `0x${string}`): Promise<NFTCollectionSummary | undefined> {
  try {
    const [name, symbol, creator, contractURI, nextTokenId, initialSupply, initialMinted, royaltyBps, latestPhaseId] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address, abi: blueEditionAbi, functionName: "name" },
        { address, abi: blueEditionAbi, functionName: "symbol" },
        { address, abi: blueEditionAbi, functionName: "owner" },
        { address, abi: blueEditionAbi, functionName: "contractURI" },
        { address, abi: blueEditionAbi, functionName: "nextTokenId" },
        { address, abi: blueEditionAbi, functionName: "maxSupply", args: [1n] },
        { address, abi: blueEditionAbi, functionName: "lifetimeMinted", args: [1n] },
        { address, abi: blueEditionAbi, functionName: "royaltyBps" },
        { address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "latestPhaseId", args: [address, 1n] }
      ]
    });
    const metadata = await readTokenMetadata(contractURI);
    let status: NFTCollectionSummary["status"] = "Draft";
    let access: NFTCollectionSummary["access"] = "Not configured";
    let mintPriceEth: string | undefined;
    let isFree = false;
    if (latestPhaseId > 0n) {
      const phase = await client.readContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "phases", args: [address, 1n, latestPhaseId] });
      const now = Math.floor(Date.now() / 1000);
      access = Number(phase[0]) === 1 ? "Allowlist" : "Public";
      if (access === "Public") {
        mintPriceEth = formatEther(phase[3]);
        isFree = phase[3] === 0n;
      }
      status = phase[11] ? "Ended" : now < Number(phase[4]) ? "Upcoming" : now < Number(phase[5]) ? "Live" : "Ended";
    }
    return {
      id: id.toString(), address, creator: getAddress(creator), factory: nftAddresses.collectionFactory, deployment: "current", name, symbol,
      imageUrl: metadata.imageURI ? optimizedTokenImageUrl(metadata.imageURI) : undefined,
      description: metadata.description,
      itemCount: Math.max(0, Number(nextTokenId - 1n)),
      initialSupply: initialSupply.toString(), initialMinted: initialMinted.toString(),
      royaltyPercent: (Number(royaltyBps) / 100).toFixed(Number(royaltyBps) % 100 ? 2 : 0),
      phaseId: latestPhaseId.toString(), mintPriceEth, access, status, isFree,
      standard: "ERC-1155"
    };
  } catch (error) {
    console.error(`Failed to load NFT collection ${address}`, error);
    return undefined;
  }
}

async function loadPFPCollection(client: NFTClient, id: bigint, address: `0x${string}`): Promise<NFTCollectionSummary | undefined> {
  try {
    const [name, symbol, creator, contractURI, supply, minted, royaltyBps, latestPhaseId] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address, abi: bluePFPAbi, functionName: "name" },
        { address, abi: bluePFPAbi, functionName: "symbol" },
        { address, abi: bluePFPAbi, functionName: "owner" },
        { address, abi: bluePFPAbi, functionName: "contractURI" },
        { address, abi: bluePFPAbi, functionName: "collectionMaxSupply" },
        { address, abi: bluePFPAbi, functionName: "totalLifetimeMinted" },
        { address, abi: bluePFPAbi, functionName: "royaltyBps" },
        { address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "latestPhaseId", args: [address, 1n] }
      ]
    });
    const metadata = await readTokenMetadata(contractURI);
    const phaseState = await phaseSummary(client, address, latestPhaseId);
    return {
      id: `P${id}`, address, creator: getAddress(creator), factory: nftAddresses.pfpFactory, deployment: "current", name, symbol,
      imageUrl: metadata.imageURI ? optimizedTokenImageUrl(metadata.imageURI) : undefined,
      description: metadata.description, itemCount: Number(supply), initialSupply: supply.toString(), initialMinted: minted.toString(),
      royaltyPercent: (Number(royaltyBps) / 100).toFixed(Number(royaltyBps) % 100 ? 2 : 0),
      phaseId: latestPhaseId.toString(), standard: "ERC-721 PFP", ...phaseState
    };
  } catch (error) {
    console.error(`Failed to load PFP collection ${address}`, error);
    return undefined;
  }
}

async function phaseSummary(client: NFTClient, collection: `0x${string}`, latestPhaseId: bigint) {
  let status: NFTCollectionSummary["status"] = "Draft";
  let access: NFTCollectionSummary["access"] = "Not configured";
  let mintPriceEth: string | undefined; let isFree = false;
  if (latestPhaseId > 0n) {
    const phase = await client.readContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "phases", args: [collection, 1n, latestPhaseId] });
    const now = Math.floor(Date.now() / 1000); access = Number(phase[0]) === 1 ? "Allowlist" : "Public";
    if (access === "Public") { mintPriceEth = formatEther(phase[3]); isFree = phase[3] === 0n; }
    status = phase[11] ? "Ended" : now < Number(phase[4]) ? "Upcoming" : now < Number(phase[5]) ? "Live" : "Ended";
  }
  return { status, access, mintPriceEth, isFree };
}
