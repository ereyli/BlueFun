// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IFeePolicy} from "./interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "./interfaces/IRevenueRouter.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

interface IUnifiedFeePoolManager {
    function take(address currency, address to, uint256 amount) external;
}

/// @notice Shared Uniswap v4 fee hook for Direct launches and graduated Bond launches.
/// @dev Exact-input only. Buy charges native platform/creator fees before the swap. Sell burns the token fee
///      before the swap and charges the platform fee from actual native output after the swap.
contract UnifiedFeeHook is ReentrancyGuard {
    error NotOwner();
    error NotPoolManager();
    error NotLocker();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidHookAddress();
    error InvalidPool();
    error UnauthorizedInitialization();
    error ExactOutputUnsupported();
    error FeeOverflow();
    error NoCreatorRevenue();
    error NativeTransferFailed();

    uint160 public constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 public constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 public constant OVERRIDE_FEE_FLAG = 0x400000;
    uint16 public constant BPS = 10_000;
    address public constant DEAD_WALLET = 0x000000000000000000000000000000000000dEaD;

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

    struct PoolRegistration {
        address token;
        address creator;
        bool registered;
    }

    address public immutable owner;
    address public immutable poolManager;
    IFeePolicy public immutable policy;
    IRevenueRouter public immutable revenueRouter;
    bool public configured;
    mapping(address locker => bool allowed) public allowedLockers;
    mapping(bytes32 poolId => uint160 expectedSqrtPriceX96) public authorizedInitializations;
    mapping(bytes32 poolId => PoolRegistration registration) public pools;
    mapping(bytes32 poolId => uint256 amount) public platformNativeRevenue;
    mapping(bytes32 poolId => uint256 amount) public creatorNativeRevenue;
    mapping(bytes32 poolId => uint256 amount) public burnedTokenFees;
    mapping(address creator => uint256 amount) public pendingCreatorRevenue;

    event LockersConfigured(address[] lockers);
    event PoolAuthorized(bytes32 indexed poolId, address indexed token, address indexed creator, uint160 sqrtPriceX96);
    event PoolInitializationConsumed(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event BuyFeesPaid(bytes32 indexed poolId, uint256 platformNative, uint256 creatorNative);
    event SellFeesPaid(bytes32 indexed poolId, uint256 platformNative, uint256 tokenBurned);
    event CreatorRevenueClaimed(address indexed creator, address indexed recipient, uint256 amount);

    constructor(address owner_, address poolManager_, IFeePolicy policy_, IRevenueRouter revenueRouter_) {
        if (
            owner_ == address(0) || poolManager_ == address(0) || address(policy_) == address(0)
                || address(revenueRouter_) == address(0)
        ) revert InvalidAddress();
        if ((uint160(address(this)) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS) revert InvalidHookAddress();
        owner = owner_;
        poolManager = poolManager_;
        policy = policy_;
        revenueRouter = revenueRouter_;
    }

    receive() external payable {
        if (msg.sender != poolManager) revert NotPoolManager();
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

    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96, address token, address creator) external {
        if (!allowedLockers[msg.sender]) revert NotLocker();
        if (sqrtPriceX96 == 0 || token == address(0) || creator == address(0)) revert InvalidAddress();
        if (pools[poolId].registered) revert UnauthorizedInitialization();
        authorizedInitializations[poolId] = sqrtPriceX96;
        pools[poolId] = PoolRegistration(token, creator, true);
        emit PoolAuthorized(poolId, token, creator, sqrtPriceX96);
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
        returns (bytes4, int256 beforeSwapDelta, uint24 lpFeeOverride)
    {
        if (msg.sender != poolManager) revert NotPoolManager();
        bytes32 poolId = _validatePool(key);
        PoolRegistration memory pool = pools[poolId];
        if (!pool.registered || pool.token != key.currency1) revert InvalidPool();
        if (params.amountSpecified >= 0) revert ExactOutputUnsupported();

        uint256 grossInput = _absolute(params.amountSpecified);
        uint256 specifiedFee;
        if (params.zeroForOne) {
            uint256 platformFee = (grossInput * policy.buyPlatformFeeBps()) / BPS;
            uint256 creatorFee = (grossInput * policy.buyCreatorFeeBps()) / BPS;
            specifiedFee = platformFee + creatorFee;
            if (platformFee != 0) IUnifiedFeePoolManager(poolManager).take(address(0), address(revenueRouter), platformFee);
            if (creatorFee != 0) {
                IUnifiedFeePoolManager(poolManager).take(address(0), address(this), creatorFee);
                pendingCreatorRevenue[pool.creator] += creatorFee;
            }
            platformNativeRevenue[poolId] += platformFee;
            creatorNativeRevenue[poolId] += creatorFee;
            emit BuyFeesPaid(poolId, platformFee, creatorFee);
        } else {
            specifiedFee = (grossInput * policy.sellBurnFeeBps()) / BPS;
            if (specifiedFee != 0) IUnifiedFeePoolManager(poolManager).take(pool.token, DEAD_WALLET, specifiedFee);
            burnedTokenFees[poolId] += specifiedFee;
            emit SellFeesPaid(poolId, 0, specifiedFee);
        }
        if (specifiedFee > uint256(uint128(type(int128).max))) revert FeeOverflow();
        beforeSwapDelta = _toBeforeSwapDelta(int128(uint128(specifiedFee)), 0);
        return (this.beforeSwap.selector, beforeSwapDelta, OVERRIDE_FEE_FLAG);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, int256 delta, bytes calldata)
        external
        returns (bytes4, int128 hookDeltaUnspecified)
    {
        if (msg.sender != poolManager) revert NotPoolManager();
        bytes32 poolId = _validatePool(key);
        if (!pools[poolId].registered) revert InvalidPool();
        if (params.amountSpecified >= 0) revert ExactOutputUnsupported();
        if (params.zeroForOne) return (this.afterSwap.selector, 0);

        int128 nativeOutput;
        assembly ("memory-safe") {
            nativeOutput := sar(128, delta)
        }
        if (nativeOutput <= 0) return (this.afterSwap.selector, 0);
        uint256 platformFee = (uint256(uint128(nativeOutput)) * policy.sellPlatformFeeBps()) / BPS;
        if (platformFee == 0) return (this.afterSwap.selector, 0);
        if (platformFee > uint256(uint128(type(int128).max))) revert FeeOverflow();
        IUnifiedFeePoolManager(poolManager).take(address(0), address(revenueRouter), platformFee);
        platformNativeRevenue[poolId] += platformFee;
        emit SellFeesPaid(poolId, platformFee, 0);
        return (this.afterSwap.selector, int128(uint128(platformFee)));
    }

    function claimCreatorRevenue(address payable recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = pendingCreatorRevenue[msg.sender];
        if (amount == 0) revert NoCreatorRevenue();
        pendingCreatorRevenue[msg.sender] = 0;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit CreatorRevenueClaimed(msg.sender, recipient, amount);
    }

    function _validatePool(PoolKey calldata key) private view returns (bytes32 poolId) {
        if (
            key.currency0 != address(0) || key.currency1 == address(0) || key.fee != DYNAMIC_FEE_FLAG
                || key.hooks != address(this)
        ) revert InvalidPool();
        poolId = keccak256(abi.encode(key));
    }

    function _absolute(int256 value) private pure returns (uint256) {
        unchecked {
            return uint256(-(value + 1)) + 1;
        }
    }

    function _toBeforeSwapDelta(int128 specified, int128 unspecified) private pure returns (int256 delta) {
        assembly ("memory-safe") {
            delta := or(shl(128, specified), and(sub(shl(128, 1), 1), unspecified))
        }
    }
}
