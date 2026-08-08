"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { ChevronDown, Wallet } from "@/components/bluefun-icons";
import { chainSlugFromPath, namedChainParam } from "@/lib/chain-slug";

export function WalletButton() {
  const solanaWallet = useWallet();
  const { setVisible } = useWalletModal();
  const { isConnected: evmConnected } = useAccount();
  const { disconnectAsync: disconnectEvm } = useDisconnect();
  const pathname = usePathname();
  const solanaSelected = (namedChainParam(useSearchParams().get("chain")) || chainSlugFromPath(pathname)) === "solana";

  useEffect(() => {
    if (solanaSelected && evmConnected) {
      void disconnectEvm();
    }
  }, [disconnectEvm, evmConnected, solanaSelected]);

  if (solanaSelected) {
    if (!solanaWallet.connected || !solanaWallet.publicKey) {
      return (
        <button className="button primary wallet-control" onClick={() => setVisible(true)} type="button">
          <Wallet size={17} />
          <span className="wallet-label-wide">Connect Solana</span>
          <span className="wallet-label-compact">Connect</span>
        </button>
      );
    }
    const address = solanaWallet.publicKey.toBase58();
    return (
      <button className="button wallet-control connected" onClick={() => void solanaWallet.disconnect()} title="Disconnect Solana wallet" type="button">
        <span className="wallet-status-dot" />
        <span>{address.slice(0, 4)}…{address.slice(-4)}</span>
        <ChevronDown size={15} />
      </button>
    );
  }

  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!connected) {
          return (
            <button className="button primary wallet-control" disabled={!ready} onClick={openConnectModal} type="button">
              <Wallet size={17} />
              <span className="wallet-label-wide">Connect Wallet</span>
              <span className="wallet-label-compact">Connect</span>
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button className="button primary wallet-control" onClick={openChainModal} type="button">
              Wrong Network
            </button>
          );
        }

        return (
          <button className="button wallet-control connected" onClick={openAccountModal} type="button">
            <span className="wallet-status-dot" />
            <span>{account.displayName}</span>
            <ChevronDown size={15} />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
