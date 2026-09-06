// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IERC20Minimal} from "../UniswapV4LiquidityLocker.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";

interface IStockFeePoolManager {
    function take(address currency, address to, uint256 amount) external;
}

/// @notice Direction-safe Uniswap v4 fee hook for meme/stock pools.
/// @dev Buy: 0.7% platform + 0.3% creator in stock quote. Sell: 0.7% platform in stock quote
///      plus 0.3% meme-token burn, using the shared FeePolicy values.
contract StockFeeHook is ReentrancyGuard {
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
    error NoRevenue();
    error TransferFailed();

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
        address quoteToken;
        address creator;
        bool registered;
    }

    address public immutable owner;
    address public immutable poolManager;
    address public immutable platformFeeRecipient;
    IFeePolicy public immutable policy;
    bool public configured;
    mapping(address locker => bool allowed) public allowedLockers;
    mapping(bytes32 poolId => uint160 expectedSqrtPriceX96) public authorizedInitializations;
    mapping(bytes32 poolId => PoolRegistration registration) public pools;
    mapping(address account => mapping(address currency => uint256 amount)) public pendingRevenue;

    event LockersConfigured(address[] lockers);
    event PoolAuthorized(
        bytes32 indexed poolId, address indexed token, address indexed quoteToken, address creator, uint160 sqrtPriceX96
    );
    event PoolInitializationConsumed(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event BuyFeesPaid(bytes32 indexed poolId, uint256 platformQuote, uint256 creatorQuote);
    event SellFeesPaid(bytes32 indexed poolId, uint256 platformQuote, uint256 tokenBurned);
    event RevenueClaimed(address indexed account, address indexed currency, uint256 amount);

    constructor(address owner_, address poolManager_, address platformFeeRecipient_, IFeePolicy policy_) {
        if (
            owner_ == address(0) || poolManager_ == address(0) || platformFeeRecipient_ == address(0)
                || address(policy_) == address(0)
        ) revert InvalidAddress();
        if ((uint160(address(this)) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS) revert InvalidHookAddress();
        owner = owner_;
        poolManager = poolManager_;
        platformFeeRecipient = platformFeeRecipient_;
        policy = policy_;
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

    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96, address token, address quoteToken, address creator)
        external
    {
        if (!allowedLockers[msg.sender]) revert NotLocker();
        if (sqrtPriceX96 == 0 || token == address(0) || quoteToken == address(0) || creator == address(0)) {
            revert InvalidAddress();
        }
        if (pools[poolId].registered) revert UnauthorizedInitialization();
        authorizedInitializations[poolId] = sqrtPriceX96;
        pools[poolId] = PoolRegistration({token: token, quoteToken: quoteToken, creator: creator, registered: true});
        emit PoolAuthorized(poolId, token, quoteToken, creator, sqrtPriceX96);
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
        if (!pool.registered) revert InvalidPool();
        if (params.amountSpecified >= 0) revert ExactOutputUnsupported();
        bool quoteIsCurrency0 = pool.quoteToken == key.currency0;
        bool isBuy = params.zeroForOne == quoteIsCurrency0;
        uint256 grossInput = _absolute(params.amountSpecified);
        uint256 specifiedFee;
        if (isBuy) {
            uint256 platformFee = (grossInput * policy.buyPlatformFeeBps()) / BPS;
            uint256 creatorFee = (grossInput * policy.buyCreatorFeeBps()) / BPS;
            specifiedFee = platformFee + creatorFee;
            if (platformFee != 0) {
                IStockFeePoolManager(poolManager).take(pool.quoteToken, address(this), platformFee);
                pendingRevenue[platformFeeRecipient][pool.quoteToken] += platformFee;
            }
            if (creatorFee != 0) {
                IStockFeePoolManager(poolManager).take(pool.quoteToken, address(this), creatorFee);
                pendingRevenue[pool.creator][pool.quoteToken] += creatorFee;
            }
            emit BuyFeesPaid(poolId, platformFee, creatorFee);
        } else {
            specifiedFee = (grossInput * policy.sellBurnFeeBps()) / BPS;
            if (specifiedFee != 0) IStockFeePoolManager(poolManager).take(pool.token, DEAD_WALLET, specifiedFee);
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
        PoolRegistration memory pool = pools[poolId];
        if (!pool.registered || params.amountSpecified >= 0) revert InvalidPool();
        bool quoteIsCurrency0 = pool.quoteToken == key.currency0;
        bool isBuy = params.zeroForOne == quoteIsCurrency0;
        if (isBuy) return (this.afterSwap.selector, 0);
        int128 quoteOutput = _unspecifiedAmount(params.zeroForOne, delta);
        if (quoteOutput <= 0) return (this.afterSwap.selector, 0);
        uint256 platformFee = (uint256(uint128(quoteOutput)) * policy.sellPlatformFeeBps()) / BPS;
        if (platformFee == 0) return (this.afterSwap.selector, 0);
        if (platformFee > uint256(uint128(type(int128).max))) revert FeeOverflow();
        IStockFeePoolManager(poolManager).take(pool.quoteToken, address(this), platformFee);
        pendingRevenue[platformFeeRecipient][pool.quoteToken] += platformFee;
        emit SellFeesPaid(poolId, platformFee, 0);
        return (this.afterSwap.selector, int128(uint128(platformFee)));
    }

    function claimRevenue(address currency) external nonReentrant returns (uint256 amount) {
        amount = pendingRevenue[msg.sender][currency];
        if (amount == 0) revert NoRevenue();
        pendingRevenue[msg.sender][currency] = 0;
        if (!IERC20Minimal(currency).transfer(msg.sender, amount)) revert TransferFailed();
        emit RevenueClaimed(msg.sender, currency, amount);
    }

    function _validatePool(PoolKey calldata key) private view returns (bytes32 poolId) {
        if (
            key.currency0 == address(0) || key.currency1 == address(0) || key.currency0 >= key.currency1
                || key.fee != DYNAMIC_FEE_FLAG || key.hooks != address(this)
        ) revert InvalidPool();
        poolId = keccak256(abi.encode(key));
        PoolRegistration memory pool = pools[poolId];
        if (
            pool.registered
                && !((pool.token == key.currency0 && pool.quoteToken == key.currency1)
                    || (pool.token == key.currency1 && pool.quoteToken == key.currency0))
        ) revert InvalidPool();
    }

    function _unspecifiedAmount(bool zeroForOne, int256 delta) private pure returns (int128 value) {
        if (zeroForOne) {
            value = int128(delta);
        } else {
            assembly ("memory-safe") {
                value := sar(128, delta)
            }
        }
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
