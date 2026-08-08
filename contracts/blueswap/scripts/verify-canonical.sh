#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
canonical_hash="0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f"

forge build \
  --root "$project_dir/lib/v2-core" \
  --contracts contracts \
  --out "$project_dir/out/canonical-core" \
  --cache-path "$project_dir/cache/canonical-core" \
  --use 0.5.16 \
  --evm-version istanbul \
  --optimize \
  --optimizer-runs 999999

pair_bytecode="$(jq -r '.bytecode.object' "$project_dir/out/canonical-core/UniswapV2Pair.sol/UniswapV2Pair.json")"
compiled_hash="$(cast keccak "$pair_bytecode")"
if [[ "$compiled_hash" != "$canonical_hash" ]]; then
  echo "Canonical Pair creation-code hash mismatch: expected $canonical_hash, got $compiled_hash" >&2
  exit 1
fi

forge build \
  --root "$project_dir/lib/v2-periphery" \
  --contracts contracts \
  --out "$project_dir/out/canonical-periphery" \
  --cache-path "$project_dir/cache/canonical-periphery" \
  --use 0.6.6 \
  --evm-version istanbul \
  --optimize \
  --optimizer-runs 999999 \
  --remappings "@uniswap/v2-core/=$project_dir/lib/v2-core/" \
  --remappings "@uniswap/lib/=$project_dir/lib/solidity-lib/"

forge test --root "$project_dir"
echo "BlueSwap V2 canonical source, Pair hash, build and fee-on accounting checks passed."
