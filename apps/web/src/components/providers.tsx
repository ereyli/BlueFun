"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, fallback, http } from "wagmi";
import { useState } from "react";
import { baseChain } from "@/lib/base-chain";
import { robinhoodChain } from "@/lib/robinhood-chain";
import { baseRpcUrls } from "@/lib/rpc";

const baseTransports = baseRpcUrls().map((url) => http(url));
const robinhoodTransport = http(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com");

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
