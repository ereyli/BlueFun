import type { DeployedLaunch } from "@/lib/onchain-launches";

export type WalletTradeSummary = {
  launch: DeployedLaunch;
  buyCount: number;
  sellCount: number;
  boughtTokens: string;
  soldTokens: string;
  spentNative: string;
  receivedNative: string;
  lastTradeAt?: string;
};

export type WalletDashboardData = {
  created: DeployedLaunch[];
  traded: WalletTradeSummary[];
  indexed: boolean;
};
