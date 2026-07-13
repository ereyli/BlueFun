"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { darkTheme, getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, fallback, http } from "wagmi";
import { useEffect, useState } from "react";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { baseRpcUrls, robinhoodRpcUrls } from "@/lib/rpc";

const baseTransports = baseRpcUrls().map((url) => http(url));
const robinhoodTransport = fallback(robinhoodRpcUrls().map((url) => http(url)), { rank: true, retryCount: 1 });

const config = getDefaultConfig({
  appName: "BlueFun",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "missing-project-id",
  chains: [baseChain, robinhoodChain],
  transports: {
    [baseChain.id]: fallback(baseTransports, { rank: true, retryCount: 1 }),
    [robinhoodChain.id]: robinhoodTransport
  },
  ssr: true
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
