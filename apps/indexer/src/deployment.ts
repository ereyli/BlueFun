export const chainId = 8453;
export const defaultRpcUrl = "https://mainnet.base.org";

export const mainnetDeployment = {
  launchFactory: undefined as `0x${string}` | undefined,
  bondingCurveMarket: undefined as `0x${string}` | undefined,
  graduationManager: undefined as `0x${string}` | undefined,
  startBlock: 0n
};

export function deploymentScope() {
  if (!mainnetDeployment.launchFactory || !mainnetDeployment.bondingCurveMarket || mainnetDeployment.startBlock === 0n) return "";
  return `${chainId}:${mainnetDeployment.launchFactory.toLowerCase()}:${mainnetDeployment.bondingCurveMarket.toLowerCase()}:${mainnetDeployment.startBlock.toString()}`;
}
