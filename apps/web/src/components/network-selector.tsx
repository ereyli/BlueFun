"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { NetworkIcon, networkMeta } from "@/components/network-icon";

const networks = [baseChain.id, robinhoodChain.id] as const;

export function NetworkSelector() {
  const { chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestedChainId = Number(searchParams.get("chain"));
  const selectedChainId = requestedChainId === robinhoodChain.id
    ? robinhoodChain.id
    : requestedChainId === baseChain.id
      ? baseChain.id
      : chainId === robinhoodChain.id
        ? robinhoodChain.id
        : baseChain.id;
  const selectedNetwork = networkMeta(selectedChainId);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function selectNetwork(nextChainId: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("chain", String(nextChainId));
    const destination = /^\/launch\/[^/]+$/.test(pathname) ? "/" : pathname;
    router.push(`${destination}?${params.toString()}`);
    if (chainId && chainId !== nextChainId) switchChain({ chainId: nextChainId });
    setOpen(false);
  }

  return (
    <div className="network-selector" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Network: ${selectedNetwork.name}`}
        className={open ? "network-trigger open" : "network-trigger"}
        disabled={isPending}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <NetworkIcon chainId={selectedChainId} size={24} />
        <span className="network-trigger-copy"><small>Network</small><strong>{selectedNetwork.name}</strong></span>
        <ChevronDown className="network-chevron" size={16} />
      </button>
      {open ? (
        <div className="network-menu" role="menu" aria-label="Select network">
          <div className="network-menu-label">Choose network</div>
          {networks.map((networkId) => {
            const network = networkMeta(networkId);
            const active = networkId === selectedChainId;
            return (
              <button
                className={active ? "network-option active" : "network-option"}
                key={networkId}
                onClick={() => selectNetwork(networkId)}
                role="menuitem"
                type="button"
              >
                <NetworkIcon chainId={networkId} size={30} />
                <span><strong>{network.name}</strong><small>{networkId === 8453 ? "B20 native launches" : "ERC-20 launches"}</small></span>
                {active ? <Check size={17} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
