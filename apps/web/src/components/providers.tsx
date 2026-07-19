"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectorsForWallets, darkTheme, getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider, createConfig, fallback, http } from "wagmi";
import { useEffect, useState } from "react";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { baseRpcUrls, robinhoodRpcUrls } from "@/lib/rpc";
import { BLUEFUN_DATA_SUFFIX } from "@/lib/base-builder-code";

const baseTransports = baseRpcUrls().map((url) => http(url));
const robinhoodTransport = fallback(robinhoodRpcUrls().map((url) => http(url)), { rank: true, retryCount: 1 });

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const sharedConfig = {
  chains: [baseChain, robinhoodChain] as const,
  transports: {
    [baseChain.id]: fallback(baseTransports, { rank: true, retryCount: 1 }),
    [robinhoodChain.id]: robinhoodTransport
  },
  ssr: true
};

const config = walletConnectProjectId ? getDefaultConfig({
  appName: "BlueFun",
  projectId: walletConnectProjectId,
  ...sharedConfig,
  dataSuffix: BLUEFUN_DATA_SUFFIX,
}) : createConfig({
  ...sharedConfig,
  connectors: connectorsForWallets([{
    groupName: "Installed wallets",
    wallets: [injectedWallet, coinbaseWallet]
  }], { appName: "BlueFun", projectId: "injected-wallets-only" })
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const syncTheme = () => setDark(document.documentElement.dataset.theme === "dark");
    syncTheme();
    window.addEventListener("bluefun-theme-change", syncTheme);
    return () => window.removeEventListener("bluefun-theme-change", syncTheme);
  }, []);

  const walletTheme = (dark ? darkTheme : lightTheme)({
    accentColor: "#2457f5",
    borderRadius: "small"
  });

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={walletTheme}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
