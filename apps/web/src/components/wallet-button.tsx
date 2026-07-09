"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, Wallet } from "lucide-react";

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!connected) {
          return (
            <button className="button primary wallet-control" disabled={!ready} onClick={openConnectModal} type="button">
              <Wallet size={17} />
              <span>Connect Wallet</span>
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
