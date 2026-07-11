"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { NetworkIcon, networkMeta } from "@/components/network-icon";

const networks = [baseChain.id, robinhoodChain.id] as const;

export function NetworkSelector() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending } = useSwitchChain();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [switchError, setSwitchError] = useState("");
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

  async function selectNetwork(nextChainId: number) {
    setSwitchError("");
    if (isConnected && chainId !== nextChainId) {
      try {
        await switchChainAsync({ chainId: nextChainId });
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        setSwitchError(message.includes("rejected") || message.includes("denied")
          ? "Network switch was cancelled in your wallet."
          : "Your wallet could not switch networks. Try again from the wallet.");
        setOpen(false);
        return;
      }
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("chain", String(nextChainId));
    const destination = /^\/launch\/[^/]+$/.test(pathname) ? "/" : pathname;
    router.push(`${destination}?${params.toString()}`);
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
      {switchError ? <div className="network-switch-error" role="status">{switchError}</div> : null}
    </div>
  );
}
