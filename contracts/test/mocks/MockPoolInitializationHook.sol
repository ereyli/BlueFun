// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract MockPoolInitializationHook {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    address public poolManager;
    mapping(address => bool) public allowedLockers;
    mapping(bytes32 => uint160) public expectedPrices;

    function initialize(address poolManager_) external {
        require(poolManager == address(0), "initialized");
        poolManager = poolManager_;
    }

    function allowLocker(address locker) external {
        allowedLockers[locker] = true;
    }

    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96) external {
        require(allowedLockers[msg.sender], "locker");
        expectedPrices[poolId] = sqrtPriceX96;
    }

    function beforeInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4) {
        require(msg.sender == poolManager, "pool manager");
        bytes32 poolId = keccak256(abi.encode(key));
        require(key.hooks == address(this) && expectedPrices[poolId] == sqrtPriceX96, "unauthorized");
        delete expectedPrices[poolId];
        return this.beforeInitialize.selector;
    }
}
