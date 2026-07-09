"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";

export function NetworkSelector() {
  const { chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedChainId = Number(searchParams.get("chain"));
  const selectedChainId = requestedChainId === robinhoodChain.id ? robinhoodChain.id : chainId === robinhoodChain.id ? robinhoodChain.id : baseChain.id;

  return (
    <label className="network-selector">
      <span>Network</span>
      <select
        aria-label="Active launchpad network"
        disabled={isPending}
        onChange={(event) => {
          const nextChainId = Number(event.target.value);
          const params = new URLSearchParams(searchParams.toString());
          params.set("chain", String(nextChainId));
          router.push(`${pathname}?${params.toString()}`);
          if (chainId) switchChain({ chainId: nextChainId });
        }}
        value={selectedChainId}
      >
        <option value={baseChain.id}>Base</option>
        <option value={robinhoodChain.id}>Robinhood</option>
      </select>
    </label>
  );
}
