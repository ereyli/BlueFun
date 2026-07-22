"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectorsForWallets, darkTheme, getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider, createConfig, fallback, http } from "wagmi";
import { useEffect, useState } from "react";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { monadChain } from "@/lib/monad-chain";
import { baseRpcUrls, monadRpcUrls, robinhoodRpcUrls } from "@/lib/rpc";
import { BLUEFUN_DATA_SUFFIX } from "@/lib/base-builder-code";

const baseTransports = baseRpcUrls().map((url) => http(url, { timeout: 6_000, retryCount: 0 }));
const robinhoodTransport = fallback(robinhoodRpcUrls().map((url) => http(url, { timeout: 6_000, retryCount: 0 })), { rank: true, retryCount: 1 });
const monadTransport = fallback(monadRpcUrls().map((url) => http(url, { timeout: 6_000, retryCount: 0 })), { rank: true, retryCount: 1 });

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const sharedConfig = {
  chains: [baseChain, robinhoodChain, monadChain] as const,
  transports: {
    [baseChain.id]: fallback(baseTransports, { rank: true, retryCount: 1 }),
    [robinhoodChain.id]: robinhoodTransport,
    [monadChain.id]: monadTransport
  },
  batch: { multicall: true },
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
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 4_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: true
      }
    }
  }));
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
