"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { nftAddresses, nftDropControllerAbi } from "@/lib/nft-contracts";

export type MintPhaseData = readonly [number, number, `0x${string}`, bigint, bigint, bigint, bigint, number, number, `0x${string}`, bigint, boolean];

export function useNFTMintPhase(collection: `0x${string}`, tokenId: bigint, enabled: boolean) {
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const latest = useReadContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "latestPhaseId", args: [collection, tokenId], chainId: 8453, query: { enabled } });
  const phaseIds = useMemo(() => {
    const last = latest.data ?? 0n;
    if (last === 0n) return [];
    const first = last > 31n ? last - 31n : 1n;
    return Array.from({ length: Number(last - first + 1n) }, (_, index) => first + BigInt(index));
  }, [latest.data]);
  const phaseReads = useReadContracts({ contracts: phaseIds.map((phaseId) => ({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "phases" as const, args: [collection, tokenId, phaseId] as const, chainId: 8453 })), query: { enabled: enabled && phaseIds.length > 0 } });

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(() => {
    const rows = (phaseReads.data || []).map((row, index) => row.status === "success" ? { id: phaseIds[index], data: row.result as unknown as MintPhaseData } : undefined).filter((row): row is { id: bigint; data: MintPhaseData } => Boolean(row && !row.data[11]));
    const active = rows.find((row) => nowSeconds >= row.data[4] && nowSeconds < row.data[5]);
    if (active) return active;
    const upcoming = rows.filter((row) => row.data[4] > nowSeconds).sort((a, b) => a.data[4] < b.data[4] ? -1 : a.data[4] > b.data[4] ? 1 : 0)[0];
    return upcoming || rows.at(-1);
  }, [nowSeconds, phaseIds, phaseReads.data]);

  return { phaseId: selected?.id ?? 0n, phaseData: selected?.data, nowSeconds, latestPhaseId: latest.data ?? 0n, isLoading: latest.isLoading || phaseReads.isLoading };
}
