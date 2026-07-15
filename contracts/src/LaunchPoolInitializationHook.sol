// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Restricts Uniswap v4 pool initialization to one-time authorizations from frozen launch lockers.
contract LaunchPoolInitializationHook {
    error NotOwner();
    error NotPoolManager();
    error NotLocker();
    error AlreadyConfigured();
    error InvalidAddress();
    error UnauthorizedInitialization();
    error InvalidHookAddress();

    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant BEFORE_INITIALIZE_FLAG = 1 << 13;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    address public immutable owner;
    address public immutable poolManager;
    bool public configured;
    mapping(address locker => bool allowed) public allowedLockers;
    mapping(bytes32 poolId => uint160 expectedSqrtPriceX96) public authorizedInitializations;

    event LockersConfigured(address[] lockers);
    event PoolInitializationAuthorized(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event PoolInitializationConsumed(bytes32 indexed poolId, uint160 sqrtPriceX96);

    constructor(address owner_, address poolManager_) {
        if (owner_ == address(0) || poolManager_ == address(0)) revert InvalidAddress();
        if ((uint160(address(this)) & ALL_HOOK_MASK) != BEFORE_INITIALIZE_FLAG) revert InvalidHookAddress();
        owner = owner_;
        poolManager = poolManager_;
    }

    function configureLockers(address[] calldata lockers) external {
        if (msg.sender != owner) revert NotOwner();
        if (configured) revert AlreadyConfigured();
        if (lockers.length == 0) revert InvalidAddress();
        configured = true;
        for (uint256 i; i < lockers.length; ++i) {
            if (lockers[i] == address(0)) revert InvalidAddress();
            allowedLockers[lockers[i]] = true;
        }
        emit LockersConfigured(lockers);
    }

    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96) external {
        if (!allowedLockers[msg.sender]) revert NotLocker();
        if (sqrtPriceX96 == 0) revert UnauthorizedInitialization();
        authorizedInitializations[poolId] = sqrtPriceX96;
        emit PoolInitializationAuthorized(poolId, sqrtPriceX96);
    }


    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96, address, address) external {
        if (!allowedLockers[msg.sender]) revert NotLocker();
        if (sqrtPriceX96 == 0) revert UnauthorizedInitialization();
        authorizedInitializations[poolId] = sqrtPriceX96;
        emit PoolInitializationAuthorized(poolId, sqrtPriceX96);
    }

    function beforeInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4) {
        if (msg.sender != poolManager) revert NotPoolManager();
        bytes32 poolId = keccak256(abi.encode(key));
        if (key.hooks != address(this) || authorizedInitializations[poolId] != sqrtPriceX96) {
            revert UnauthorizedInitialization();
        }
        delete authorizedInitializations[poolId];
        emit PoolInitializationConsumed(poolId, sqrtPriceX96);
        return this.beforeInitialize.selector;
    }
}
