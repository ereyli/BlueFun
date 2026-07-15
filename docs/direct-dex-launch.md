# Direct DEX and unified fee architecture

## Launch model

BlueFun vNext supports two routes with one economic policy:

- **Bond:** users trade against the protocol curve until the fixed 5 ETH gross target, then remaining reserves enter a permanently locked Uniswap v4 pool.
- **Direct DEX:** the token, token-only Uniswap v4 liquidity and permanent LP lock are created atomically. A creator first buy is optional and cannot receive more than 5% of supply.

Both routes create a fixed 1 billion supply with zero free creator allocation. A new token-only pool can require buy-side ETH depth before a meaningful sell quote exists.

## Shared fee behavior

`FeePolicy` begins with these bounded values:

| Trade | Platform | Creator | Burn |
| --- | ---: | ---: | ---: |
| Buy | 0.7% ETH | 0.3% ETH | — |
| Sell | 0.7% ETH | — | 0.3% token input |

The maximum fee for either side is 2%. The launch fee begins at `0.001 ETH` and cannot exceed `0.01 ETH`. Changes execute only through the seven-day governance timelock.

`UnifiedFeeHook` serves Direct launches and graduated Bond pools. It accepts only exact-input swaps, overrides the Uniswap LP fee to zero and rejects exact-output paths. This prevents duplicate fees and keeps the accounting identical after Bond graduation.

Pool registration is restricted to the two permanent lockers. The token and creator mapping is written once and cannot be replaced. Creator buy revenue is pull-based, avoiding swaps that depend on whether a creator smart wallet can receive ETH during a hook callback. Sell burns are transferred directly to `0x000000000000000000000000000000000000dEaD` during the trade.

## Revenue routing

### Base

- Trade platform ETH: 50% BLUE staking, 50% treasury.
- Launch fee: initially 100% treasury.
- Manually bridged remote staking revenue: 100% staking, with no second split.

### Robinhood Chain

- Trade platform ETH: 50% treasury, 50% fixed bridge reserve.
- The reserve may be released only to the timelock-configured recipient.
- Bridging is deliberately manual; no third-party bridge contract is a protocol dependency.

## LP custody

The locker can mint and account for the position but cannot withdraw principal or transfer the position NFT. The creator, treasury, guardian and governance timelock have no principal escape path. vNext does not need a `Sync fees` or LP fee collection action because fee routing and burn accounting occur inside each trade.

## Base vNext deployment

- Unified hook: `0xF0b8dDe19510eE7D6D50Be289C4257EcD14C60CC`
- Bond factory: `0x820344FB4C0a518d0CaEf5d3De96fF41CBe6b345`
- Bond locker: `0x484345C0Fc777d1945a84ADB6284D487daFB1de8`
- Direct factory: `0x394c5D0244b49e1Eed533CD3505583e504589157`
- Direct locker: `0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7`
- Deployment block: `48678791`

Robinhood vNext has passed local tests and mainnet dry-run. Its broadcast remains pending deployer gas funding.

## Compatibility

Legacy factories, markets, lockers and hooks remain indexed for the tokens originally launched through them. They are not used as vNext defaults and are not presented as having vNext automatic routing or burn behavior.

## Security gates

- Unit, fuzz and stateful invariant tests.
- Base Uniswap v4 fork buy/sell/burn and revenue routing test.
- Static analysis review with no known high or critical vNext finding.
- Bytecode size checks.
- Per-network deployment dry-run.
- Source verification and low-value mainnet smoke test before public activation.

These controls reduce known risk but do not guarantee defect-free contracts. Low liquidity, price impact, RPC failures, aggregator discovery and irreversible transactions remain protocol usage risks.
