// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Minimal PoolManager surface used by the hook to withdraw its native-currency delta.
interface IDirectFeeBurnPoolManager {
    function take(address currency, address to, uint256 amount) external;
}

/// @notice Direction-aware Uniswap v4 hook for BlueFun direct launches.
/// @dev Buy: 1% LP fee (later split 70/30 platform/creator by the locked LP custodian).
///      Sell: 0.3% LP fee in launch tokens (burned by the custodian) plus 0.7% of actual native output
///      paid directly to the platform. Exact-output sells are rejected because afterSwap deltas are
///      denominated in the input token for that swap shape and could otherwise bypass the native fee.
contract DirectFeeBurnHook {
    error NotOwner();
    error NotPoolManager();
    error NotLocker();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidHookAddress();
    error InvalidPool();
    error UnauthorizedInitialization();
    error ExactOutputSellUnsupported();
    error FeeOverflow();

    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 2);
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 public constant OVERRIDE_FEE_FLAG = 0x400000;
    uint24 public constant BUY_FEE = 10_000; // 1.00%, in native input
    uint24 public constant SELL_BURN_FEE = 3_000; // 0.30%, in token input
    uint16 public constant SELL_PLATFORM_FEE_BPS = 70; // 0.70%, in actual native output
    uint16 public constant BPS = 10_000;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    address public immutable owner;
    address public immutable poolManager;
    address public immutable platformFeeRecipient;
    bool public configured;
    mapping(address locker => bool allowed) public allowedLockers;
    mapping(bytes32 poolId => uint160 expectedSqrtPriceX96) public authorizedInitializations;
    mapping(bytes32 poolId => bool registered) public registeredPools;
    mapping(bytes32 poolId => uint256 amount) public platformNativeRevenue;

    event LockersConfigured(address[] lockers);
    event PoolInitializationAuthorized(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event PoolInitializationConsumed(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event SellPlatformFeePaid(bytes32 indexed poolId, address indexed recipient, uint256 nativeAmount);

    constructor(address owner_, address poolManager_, address platformFeeRecipient_) {
        if (owner_ == address(0) || poolManager_ == address(0) || platformFeeRecipient_ == address(0)) {
            revert InvalidAddress();
        }
        if ((uint160(address(this)) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS) revert InvalidHookAddress();
        owner = owner_;
        poolManager = poolManager_;
        platformFeeRecipient = platformFeeRecipient_;
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
        if (sqrtPriceX96 == 0 || registeredPools[poolId]) revert UnauthorizedInitialization();
        authorizedInitializations[poolId] = sqrtPriceX96;
        registeredPools[poolId] = true;
        emit PoolInitializationAuthorized(poolId, sqrtPriceX96);
    }

    function beforeInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4) {
        if (msg.sender != poolManager) revert NotPoolManager();
        bytes32 poolId = _validatePool(key);
        if (authorizedInitializations[poolId] != sqrtPriceX96) revert UnauthorizedInitialization();
        delete authorizedInitializations[poolId];
        emit PoolInitializationConsumed(poolId, sqrtPriceX96);
        return this.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        view
        returns (bytes4, int256 beforeSwapDelta, uint24 lpFeeOverride)
    {
        if (msg.sender != poolManager) revert NotPoolManager();
        bytes32 poolId = _validatePool(key);
        if (!registeredPools[poolId]) revert InvalidPool();
        if (!params.zeroForOne && params.amountSpecified > 0) revert ExactOutputSellUnsupported();
        uint24 directionalFee = params.zeroForOne ? BUY_FEE : SELL_BURN_FEE;
        return (this.beforeSwap.selector, 0, directionalFee | OVERRIDE_FEE_FLAG);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        int256 delta,
        bytes calldata
    ) external returns (bytes4, int128 hookDeltaUnspecified) {
        if (msg.sender != poolManager) revert NotPoolManager();
        bytes32 poolId = _validatePool(key);
        if (!registeredPools[poolId]) revert InvalidPool();
        if (params.zeroForOne) return (this.afterSwap.selector, 0);
        if (params.amountSpecified > 0) revert ExactOutputSellUnsupported();

        int128 nativeOutput;
        assembly ("memory-safe") {
            nativeOutput := sar(128, delta)
        }
        if (nativeOutput <= 0) return (this.afterSwap.selector, 0);
        uint256 platformFee = (uint256(uint128(nativeOutput)) * SELL_PLATFORM_FEE_BPS) / BPS;
        if (platformFee == 0) return (this.afterSwap.selector, 0);
        if (platformFee > uint256(uint128(type(int128).max))) revert FeeOverflow();

        IDirectFeeBurnPoolManager(poolManager).take(address(0), platformFeeRecipient, platformFee);
        platformNativeRevenue[poolId] += platformFee;
        emit SellPlatformFeePaid(poolId, platformFeeRecipient, platformFee);
        return (this.afterSwap.selector, int128(uint128(platformFee)));
    }

    function _validatePool(PoolKey calldata key) private view returns (bytes32 poolId) {
        if (
            key.currency0 != address(0) || key.currency1 == address(0) || key.fee != DYNAMIC_FEE_FLAG
                || key.hooks != address(this)
        ) revert InvalidPool();
        poolId = keccak256(abi.encode(key));
    }
}
