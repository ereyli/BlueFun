# BlueSwap V2 contracts

BlueSwap V2 keeps the canonical Uniswap V2 AMM and Router02 contracts unmodified. The official repositories are pinned
as git submodules:

- `Uniswap/v2-core` at release `v1.0.1` (`4dd59067c76dea4a0e8e4bfdda41877a6b16dedc`)
- `Uniswap/v2-periphery` at `ed24991304291297c3b4a52818d02f46a17aa9a2`
- `Uniswap/solidity-lib` at `c01640b0f0f1d8a85cba8de378cc48469fcfd9a6`

The canonical build compiles each official repository from its own root: Solidity `0.5.16` for core and `0.6.6` for
Router02, EVM target `istanbul`, optimizer enabled with `999999` runs. `scripts/verify-canonical.sh` rejects a Pair
creation-code hash other than `96e8ac...8845f`; this protects Router02's deterministic pair-address calculation.

## Fee behavior

The original Uniswap V2 fee behavior is unchanged:

- every swap retains 0.30% in the pool;
- when `feeTo` is nonzero, the canonical `_mintFee` logic mints protocol-owned LP tokens on a later mint or burn;
- `feeToSetter` can change `feeTo` or transfer the setter role, but cannot change the 0.30% swap fee;
- production deployments transfer `feeToSetter` to the chain timelock before Router02 or any pool is made public.

For production, `BLUESWAP_FEE_TO_SETTER` must be a deployed timelock contract. `BLUESWAP_FEE_TO` should be the
documented protocol fee receiver. Do not use a deployer EOA for either long-lived role.

## Build and test

```sh
git submodule update --init --recursive
cd contracts/blueswap
./scripts/verify-canonical.sh
```

## Deployment

Copy `.env.example` outside version control and set chain-specific values. Confirm the chain ID, canonical wrapped
native token, fee receiver, timelock, explorer, RPC and Safe ownership before broadcasting.

Build the canonical artifacts and deploy the factory from the official core repository root. For the Base and Robinhood
launches, the chain deployer is used only as a temporary setter so the protocol fee can be activated atomically during
the deployment ceremony:

```sh
cd contracts/blueswap
./scripts/verify-canonical.sh
BLUESWAP_DIR="$(pwd)"
forge create contracts/UniswapV2Factory.sol:UniswapV2Factory \
  --root "$BLUESWAP_DIR/lib/v2-core" \
  --out "$BLUESWAP_DIR/out/canonical-core" \
  --cache-path "$BLUESWAP_DIR/cache/canonical-core" \
  --use 0.5.16 --evm-version istanbul \
  --optimize --optimizer-runs 999999 \
  --constructor-args "$BLUESWAP_DEPLOYER_ADDRESS" \
  --rpc-url "$RPC_URL" --broadcast
```

Before any pool or Router is made public, require `allPairsLength() == 0`, call `setFeeTo(BLUESWAP_FEE_TO)`, immediately
call `setFeeToSetter(BLUESWAP_FEE_TO_SETTER)`, and verify all three factory getters:

```sh
cast call "$BLUESWAP_FACTORY" "allPairsLength()(uint256)" --rpc-url "$RPC_URL"
cast call "$BLUESWAP_FACTORY" "feeTo()(address)" --rpc-url "$RPC_URL"
cast call "$BLUESWAP_FACTORY" "feeToSetter()(address)" --rpc-url "$RPC_URL"
```

Only after `feeTo()` equals the intended nonzero receiver and `feeToSetter()` equals the intended timelock should the
unmodified Router02 be deployed from the official periphery repository root:

```sh
forge create contracts/UniswapV2Router02.sol:UniswapV2Router02 \
  --root "$BLUESWAP_DIR/lib/v2-periphery" \
  --out "$BLUESWAP_DIR/out/canonical-periphery" \
  --cache-path "$BLUESWAP_DIR/cache/canonical-periphery" \
  --use 0.6.6 --evm-version istanbul \
  --optimize --optimizer-runs 999999 \
  --remappings "@uniswap/v2-core/=$BLUESWAP_DIR/lib/v2-core/" \
  --remappings "@uniswap/lib/=$BLUESWAP_DIR/lib/solidity-lib/" \
  --constructor-args "$BLUESWAP_FACTORY" "$BLUESWAP_WRAPPED_NATIVE" \
  --rpc-url "$RPC_URL" --broadcast
```

Verify the factory, every pair created by it, Router02, `feeTo`, `feeToSetter`, wrapped native address and the Pair
creation-code hash before enabling the frontend. The deployment flow intentionally does not deploy or guess a wrapped
native token; each chain must use its canonical, reviewed implementation.

## Production deployments

| Network | Factory | Router02 | Deployment record |
| --- | --- | --- | --- |
| Base | [`0xDc4f...f69C`](https://basescan.org/address/0xDc4fd3381a67F40e6CF8B54f4b33C1ddddc5f69C) | [`0x1B4D...5431`](https://basescan.org/address/0x1B4DFD836CF75E427BA49715606F25bdCbAF5431) | [`base-mainnet.json`](deployments/base-mainnet.json) |
| Robinhood Chain | [`0x9A57...FC3E`](https://robinhoodchain.blockscout.com/address/0x9A5786CAd9845dc83537cf7420D707179322FC3E) | [`0xd254...5B77`](https://robinhoodchain.blockscout.com/address/0xd2541D19f560F234754b9Cc4a688Ac4f30b35B77) | [`robinhood-mainnet.json`](deployments/robinhood-mainnet.json) |

Both factories were launched with `allPairsLength() == 0`, their nonzero protocol fee receiver set to the BlueFun 2-of-3
Safe, and their setter role transferred to the existing chain-specific 7-day timelock before Router02 deployment.
At deployment time, each timelock was still owned by its chain deployer EOA and had no pending owner. Transferring the
timelock ownership to the BlueFun Safe is a separate governance ceremony and is not implied by the Factory handoff.
The delayed ownership proposals have since been executed on both chains, so the Safe is now `pendingOwner`; two Safe
signatures and `acceptOwner()` are still required to finish each ownership transfer. See the deployment records for the
execution transaction hashes.

## License and provenance

Uniswap V2 core and periphery are GPL-3.0 licensed. Preserve upstream copyright/license notices and publish the
corresponding source for deployments. BlueSwap branding belongs in the application layer; these AMM contracts retain
their canonical source.
