export const chainId = 8453;
export const defaultRpcUrl = "https://mainnet.base.org";

export const mainnetDeployment = {
  launchFactory: "0xf65ebfdacb1a8e0a8217185aae44f489e53b88f9" as `0x${string}`,
  bondingCurveMarket: "0x4ce2154146eacf745133d7755875767d6a00ee5f" as `0x${string}`,
  graduationManager: "0x0a5769b0c8bff62e2c50014cb76f5cb4fde849c2" as `0x${string}`,
  startBlock: 48379352n
};

export function deploymentScope() {
  if (!mainnetDeployment.launchFactory || !mainnetDeployment.bondingCurveMarket || mainnetDeployment.startBlock === 0n) return "";
  return `${chainId}:${mainnetDeployment.launchFactory.toLowerCase()}:${mainnetDeployment.bondingCurveMarket.toLowerCase()}:${mainnetDeployment.startBlock.toString()}`;
}
