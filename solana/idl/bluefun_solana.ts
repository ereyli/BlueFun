/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/bluefun_solana.json`.
 */
export type BluefunSolana = {
  "address": "CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5",
  "metadata": {
    "name": "bluefunSolana",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "BlueFun Solana Direct launch registry and Meteora DAMM v2 verifier"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "pendingAdmin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "finalizeLaunch",
      "discriminator": [
        113,
        133,
        62,
        196,
        58,
        212,
        118,
        166
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "launch"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "launch"
          ]
        },
        {
          "name": "pool"
        },
        {
          "name": "creatorPosition"
        },
        {
          "name": "platformPosition"
        },
        {
          "name": "creatorPositionNft"
        },
        {
          "name": "platformPositionNft"
        },
        {
          "name": "poolTokenAVault"
        },
        {
          "name": "creatorTokenAccount"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "guardian"
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialSqrtPrice",
          "type": "u128"
        },
        {
          "name": "maxSqrtPrice",
          "type": "u128"
        }
      ]
    },
    {
      "name": "manage",
      "discriminator": [
        168,
        141,
        131,
        54,
        79,
        150,
        88,
        36
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "action",
          "type": "u8"
        },
        {
          "name": "value",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "secondary",
          "type": {
            "array": [
              "u8",
              16
            ]
          }
        }
      ]
    },
    {
      "name": "reserveLaunch",
      "discriminator": [
        60,
        214,
        0,
        184,
        198,
        221,
        230,
        168
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "launch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  97,
                  117,
                  110,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "metadataUri",
          "type": "string"
        },
        {
          "name": "initialBuyLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "launch",
      "discriminator": [
        144,
        51,
        51,
        163,
        206,
        85,
        213,
        38
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "launchesPaused",
      "msg": "Launches are paused"
    },
    {
      "code": 6001,
      "name": "invalidMetadata",
      "msg": "Metadata is invalid"
    },
    {
      "code": 6002,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6003,
      "name": "invalidMint",
      "msg": "The mint is not a BlueFun fixed-supply mint"
    },
    {
      "code": 6004,
      "name": "invalidSupply",
      "msg": "Token supply must be exactly one billion tokens"
    },
    {
      "code": 6005,
      "name": "mintAuthorityNotRevoked",
      "msg": "Mint authority must be permanently revoked"
    },
    {
      "code": 6006,
      "name": "freezeAuthorityNotRevoked",
      "msg": "Freeze authority must be permanently revoked"
    },
    {
      "code": 6007,
      "name": "invalidPoolPair",
      "msg": "The Meteora pool token pair is invalid"
    },
    {
      "code": 6008,
      "name": "invalidPoolCreator",
      "msg": "The Meteora pool creator does not match this launch"
    },
    {
      "code": 6009,
      "name": "invalidPoolVault",
      "msg": "The Meteora pool token vault is invalid"
    },
    {
      "code": 6010,
      "name": "invalidCollectFeeMode",
      "msg": "Meteora fees must be collected in the quote token"
    },
    {
      "code": 6011,
      "name": "poolDisabled",
      "msg": "The Meteora pool is disabled"
    },
    {
      "code": 6012,
      "name": "dynamicFeeNotAllowed",
      "msg": "Dynamic fees are not allowed"
    },
    {
      "code": 6013,
      "name": "invalidTradingFee",
      "msg": "Trading fee configuration is not the BlueFun one-percent profile"
    },
    {
      "code": 6014,
      "name": "invalidMeteoraAccount",
      "msg": "Invalid Meteora account"
    },
    {
      "code": 6015,
      "name": "invalidPosition",
      "msg": "Invalid Meteora position"
    },
    {
      "code": 6016,
      "name": "liquidityNotFullyLocked",
      "msg": "Liquidity is not permanently locked"
    },
    {
      "code": 6017,
      "name": "invalidPositionNft",
      "msg": "Position NFT is invalid"
    },
    {
      "code": 6018,
      "name": "invalidPositionOwner",
      "msg": "Position NFT owner is invalid"
    },
    {
      "code": 6019,
      "name": "invalidFeeSplit",
      "msg": "Permanent liquidity does not use the 70/30 split"
    },
    {
      "code": 6020,
      "name": "invalidCreatorTokenAccount",
      "msg": "Creator token account is invalid"
    },
    {
      "code": 6021,
      "name": "initialBuyTooLarge",
      "msg": "Initial purchase exceeds five percent of supply"
    },
    {
      "code": 6022,
      "name": "alreadyFinalized",
      "msg": "Launch is already finalized"
    },
    {
      "code": 6023,
      "name": "feeTooHigh",
      "msg": "Launch fee exceeds the one-SOL safety cap"
    },
    {
      "code": 6024,
      "name": "noPendingUpdate",
      "msg": "There is no pending update"
    },
    {
      "code": 6025,
      "name": "timelockActive",
      "msg": "The 48-hour timelock is still active"
    },
    {
      "code": 6026,
      "name": "unauthorized",
      "msg": "Authority is not permitted"
    },
    {
      "code": 6027,
      "name": "invalidAuthority",
      "msg": "Authority cannot be the zero address"
    },
    {
      "code": 6028,
      "name": "invalidPriceProfile",
      "msg": "The fixed Meteora price profile is invalid"
    },
    {
      "code": 6029,
      "name": "invalidAccountData",
      "msg": "Account data does not match the required layout"
    },
    {
      "code": 6030,
      "name": "invalidTokenAccount",
      "msg": "Invalid legacy SPL token account"
    },
    {
      "code": 6031,
      "name": "invalidAdminAction",
      "msg": "Unknown admin action"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "guardian",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "pendingTreasury",
            "type": "pubkey"
          },
          {
            "name": "pendingTreasuryEta",
            "type": "i64"
          },
          {
            "name": "launchFeeLamports",
            "type": "u64"
          },
          {
            "name": "pendingLaunchFeeLamports",
            "type": "u64"
          },
          {
            "name": "pendingFeeEta",
            "type": "i64"
          },
          {
            "name": "expectedBaseFeeData",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "totalTradingFeeBps",
            "type": "u16"
          },
          {
            "name": "platformShareBps",
            "type": "u16"
          },
          {
            "name": "creatorShareBps",
            "type": "u16"
          },
          {
            "name": "initialSqrtPrice",
            "type": "u128"
          },
          {
            "name": "maxSqrtPrice",
            "type": "u128"
          },
          {
            "name": "pendingInitialSqrtPrice",
            "type": "u128"
          },
          {
            "name": "pendingMaxSqrtPrice",
            "type": "u128"
          },
          {
            "name": "pendingPriceEta",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "launchCount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "launch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "creatorPosition",
            "type": "pubkey"
          },
          {
            "name": "platformPosition",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "metadataUri",
            "type": "string"
          },
          {
            "name": "initialBuyLamports",
            "type": "u64"
          },
          {
            "name": "initialCreatorTokenBalance",
            "type": "u64"
          },
          {
            "name": "reservedAt",
            "type": "i64"
          },
          {
            "name": "finalizedAt",
            "type": "i64"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
