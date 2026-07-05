// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

library B20Constants {
    address internal constant B20_FACTORY = 0xB20f000000000000000000000000000000000000;
    address internal constant ACTIVATION_REGISTRY = 0x8453000000000000000000000000000000000001;
    address internal constant POLICY_REGISTRY = 0x8453000000000000000000000000000000000002;

    bytes32 internal constant B20_ASSET_FEATURE = keccak256("base.b20_asset");
    uint64 internal constant ALWAYS_ALLOW = 0;
    uint64 internal constant ALWAYS_BLOCK = (uint64(1) << 56) | 1;
    uint256 internal constant BPS = 10_000;
}

