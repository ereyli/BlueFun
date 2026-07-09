import { encodeAbiParameters, zeroAddress } from "viem";
import { BLUEFUN_V4_POOL_FEE, BLUEFUN_V4_TICK_SPACING } from "@/lib/contracts";

export type BlueFunV4PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export function blueFunV4PoolKey(token: `0x${string}`): BlueFunV4PoolKey {
  return {
    currency0: zeroAddress,
    currency1: token,
    fee: BLUEFUN_V4_POOL_FEE,
    tickSpacing: BLUEFUN_V4_TICK_SPACING,
    hooks: zeroAddress
  };
}

export function buildV4EthToTokenSwap({
  amountIn,
  amountOutMinimum,
  token
}: {
  amountIn: bigint;
  amountOutMinimum: bigint;
  token: `0x${string}`;
}) {
  const poolKey = blueFunV4PoolKey(token);
  const actions = "0x060c0f" as const;
  const swapExactInSingle = encodeAbiParameters(
    [
      {
        name: "swap",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    [
      {
        poolKey,
        zeroForOne: true,
        amountIn,
        amountOutMinimum,
        hookData: "0x"
      }
    ]
  );
  const settleAll = encodeAbiParameters(
    [
      { name: "currency", type: "address" },
      { name: "maxAmount", type: "uint256" }
    ],
    [zeroAddress, amountIn]
  );
  const takeAll = encodeAbiParameters(
    [
      { name: "currency", type: "address" },
      { name: "minAmount", type: "uint256" }
    ],
    [token, amountOutMinimum]
  );

  const input = encodeAbiParameters(
    [
      { name: "actions", type: "bytes" },
      { name: "params", type: "bytes[]" }
    ],
    [actions, [swapExactInSingle, settleAll, takeAll]]
  );

  return {
    commands: "0x10" as const,
    inputs: [input]
  };
}

export function buildV4TokenToEthSwap({
  amountIn,
  amountOutMinimum,
  token
}: {
  amountIn: bigint;
  amountOutMinimum: bigint;
  token: `0x${string}`;
}) {
  const poolKey = blueFunV4PoolKey(token);
  const actions = "0x060c0f" as const;
  const swapExactInSingle = encodeAbiParameters(
    [
      {
        name: "swap",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    [
      {
        poolKey,
        zeroForOne: false,
        amountIn,
        amountOutMinimum,
        hookData: "0x"
      }
    ]
  );
  const settleAll = encodeAbiParameters(
    [
      { name: "currency", type: "address" },
      { name: "maxAmount", type: "uint256" }
    ],
    [token, amountIn]
  );
  const takeAll = encodeAbiParameters(
    [
      { name: "currency", type: "address" },
      { name: "minAmount", type: "uint256" }
    ],
    [zeroAddress, amountOutMinimum]
  );

  const input = encodeAbiParameters(
    [
      { name: "actions", type: "bytes" },
      { name: "params", type: "bytes[]" }
    ],
    [actions, [swapExactInSingle, settleAll, takeAll]]
  );

  return {
    commands: "0x10" as const,
    inputs: [input]
  };
}
