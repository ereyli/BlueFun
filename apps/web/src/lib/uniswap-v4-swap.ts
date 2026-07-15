import { encodeAbiParameters, zeroAddress } from "viem";
import { BLUEFUN_V4_POOL_FEE, BLUEFUN_V4_TICK_SPACING } from "@/lib/contracts";

export type BlueFunV4PoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
};

export type Permit2Single = {
  details: {
    token: `0x${string}`;
    amount: bigint;
    expiration: number;
    nonce: number;
  };
  spender: `0x${string}`;
  sigDeadline: bigint;
  signature: `0x${string}`;
};

export function blueFunV4PoolKey(
  token: `0x${string}`,
  config: { fee?: number; tickSpacing?: number; hooks?: `0x${string}` } = {}
): BlueFunV4PoolKey {
  return {
    currency0: zeroAddress,
    currency1: token,
    fee: config.fee ?? BLUEFUN_V4_POOL_FEE,
    tickSpacing: config.tickSpacing ?? BLUEFUN_V4_TICK_SPACING,
    hooks: config.hooks ?? zeroAddress
  };
}

export function buildV4EthToTokenSwap({
  amountIn,
  amountOutMinimum,
  token,
  poolFee,
  tickSpacing,
  hooks
}: {
  amountIn: bigint;
  amountOutMinimum: bigint;
  token: `0x${string}`;
  poolFee?: number;
  tickSpacing?: number;
  hooks?: `0x${string}`;
}) {
  const poolKey = blueFunV4PoolKey(token, { fee: poolFee, tickSpacing, hooks });
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
  token,
  poolFee,
  tickSpacing,
  hooks,
  permit
}: {
  amountIn: bigint;
  amountOutMinimum: bigint;
  token: `0x${string}`;
  poolFee?: number;
  tickSpacing?: number;
  hooks?: `0x${string}`;
  permit?: Permit2Single;
}) {
  const poolKey = blueFunV4PoolKey(token, { fee: poolFee, tickSpacing, hooks });
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

  if (!permit) return { commands: "0x10" as const, inputs: [input] };

  const permitInput = encodeAbiParameters(
    [
      {
        name: "permitSingle",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" }
            ]
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" }
        ]
      },
      { name: "signature", type: "bytes" }
    ],
    [{ details: permit.details, spender: permit.spender, sigDeadline: permit.sigDeadline }, permit.signature]
  );

  return {
    commands: "0x0a10" as const,
    inputs: [permitInput, input]
  };
}
