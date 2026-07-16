import { Attribution } from "ox/erc8021";

/** Base Builder Code used to attribute BlueFun's onchain activity. */
export const BLUEFUN_BUILDER_CODE = "bc_82qbdrvq";

/** ERC-8021 suffix appended by Wagmi/Viem to supported transactions. */
export const BLUEFUN_DATA_SUFFIX = Attribution.toDataSuffix({
  codes: [BLUEFUN_BUILDER_CODE]
});
