import type { DeployedLaunch } from "@/lib/onchain-launches";

export const OFFICIAL_BLUE_TOKEN = "0xb200000000000000000000af2d07754b927109bc";
export const OFFICIAL_BLUE_HOME_CHAIN_ID = 8453;

export function isOfficialBlue(launch: DeployedLaunch) {
  return launch.chainId === OFFICIAL_BLUE_HOME_CHAIN_ID
    && launch.token.toLowerCase() === OFFICIAL_BLUE_TOKEN;
}

export function isFeaturedLaunch(launch: DeployedLaunch) {
  if (isOfficialBlue(launch)) return true;

  const raw = process.env.NEXT_PUBLIC_FEATURED_TOKENS || "";
  const featured = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!featured.length) return false;
  return featured.some((value) =>
    value === launch.token.toLowerCase()
      || value === launch.id
  );
}
