"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";

type ProofEntry = { allowance: bigint; unitPrice: bigint; proof: Hex[] };

export function useNFTAllowlistProof(collection: Address, tokenId: bigint, phaseId: bigint, wallet?: Address, enabled = true) {
  const [entry, setEntry] = useState<ProofEntry>(); const [loading, setLoading] = useState(false); const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setEntry(undefined); setUnavailable(false);
    if (!enabled || !wallet || phaseId === 0n) return;
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/nft/allowlist?collection=${collection}&tokenId=${tokenId}&phaseId=${phaseId}&wallet=${wallet}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ entry?: { allowance: string; unitPrice: string; proof: Hex[] } | null }> : Promise.reject())
      .then((result) => { if (result.entry) setEntry({ allowance: BigInt(result.entry.allowance), unitPrice: BigInt(result.entry.unitPrice), proof: result.entry.proof }); else setUnavailable(true); })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [collection, tokenId, phaseId, wallet, enabled]);
  return { entry, loading, unavailable };
}
