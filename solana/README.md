# BlueFun Solana Direct

BlueFun Solana launches use Meteora DAMM v2 directly. There is no bonding curve
or graduation threshold.

Protocol invariants enforced by the BlueFun registry program:

- 1,000,000,000 fixed tokens with 9 decimals
- revoked mint and freeze authorities
- SOL launch fee starts at 0.05 SOL, is charged only when verification succeeds,
  and changes only after a 48-hour timelock
- optional creator first buy capped at 5% of supply
- Meteora DAMM v2 SOL pair with a fixed 1% fee profile and dynamic fees disabled
- quote-token-only fee collection
- all liquidity permanently locked
- locked liquidity split 70% to the platform fee position and 30% to the creator

Meteora's protocol share is deducted from the 1% pool fee. It is not added on
top of the user's 1% trading fee.

## Program

Program ID: `CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5`

The policy/verifier is a compact `no_std` Pinocchio program. Meteora remains
the shared liquidity engine; BlueFun only stores launch policy and verifies the
resulting immutable market. Build with:

```bash
npm run build
```

The deployer keypair is intentionally stored outside the repository. Never add
wallet keypairs or private keys to this directory.

The optimized mainnet binary is 48,520 bytes and currently requires
0.33859008 SOL of refundable program-data rent, plus the small program account
and transaction fees. Budget about 0.36 SOL and deploy with an exact
`--max-len 48520` so no unused upgrade capacity is funded. After deployment,
initialize the starting
price profile with a current SOL/USD input:

```bash
SOLANA_RPC_URL=https://your-private-rpc SOL_USD=150 npm run initialize
```

The treasury starts as the deployer and can later be moved to a Safe/Squads
treasury only through the 48-hour onchain timelock.

Administrative timelock operations share the compact `manage` instruction.
Its action codes are: `0/1/2` propose/apply/cancel launch fee, `3/4/5`
propose/apply/cancel treasury, `6/7` propose/apply price profile, and `8`
propose a new admin. Admin acceptance remains a separate signer-authorized
instruction.

## Local integration test

The repeatable integration test expects a local validator with Meteora DAMM v2
cloned from mainnet and the BlueFun program deployed. It creates a fixed-supply
mint, a real Meteora custom pool, permanently locks and splits liquidity 70/30,
then confirms the 0.05 SOL fee is transferred only after final verification:

```bash
SOLANA_WALLET=/path/to/local-payer.json npm run test:integration:local
```
