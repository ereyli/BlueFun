"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { useState } from "react";
import { baseSepoliaChain } from "@/lib/base-sepolia-chain";

const config = getDefaultConfig({
  appName: "BlueFun",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "missing-project-id",
  chains: [baseSepoliaChain],
  transports: {
    [baseSepoliaChain.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org")
  },
  ssr: true
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: "#0052ff",
            borderRadius: "small"
          })}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
