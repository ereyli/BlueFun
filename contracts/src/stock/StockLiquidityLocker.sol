// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../UniswapV4LiquidityLocker.sol";
import {FullMath} from "../libraries/FullMath.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";

interface IStockPoolInitializationGuard {
    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96, address token, address quoteToken, address creator)
        external;
}

/// @notice Permanently locks one-sided meme-token liquidity in a meme/stock Uniswap v4 pool.
contract StockLiquidityLocker is ReentrancyGuard {
    error NotFactory();
    error NotOwner();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidConfig();
    error InvalidPoolState();
    error ZeroLiquidity();
    error PositionMintFailed();
    error TokenApprovalFailed();

    uint256 private constant Q96 = 0x1000000000000000000000000;
    uint8 private constant ACTION_MINT_POSITION = 0x02;
    uint8 private constant ACTION_SETTLE_PAIR = 0x0d;
    uint8 private constant ACTION_SWEEP = 0x14;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant REQUIRED_HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;

    struct PoolConfig {
        int24 tickSpacing;
        int24 tickLower;
        int24 tickUpper;
        uint160 initialSqrtPriceX96;
    }

    struct LockedPosition {
        uint256 launchId;
        address token;
        address quoteToken;
        address creator;
        uint256 tokenId;
        uint128 liquidity;
        uint256 tokenAmount;
        bytes32 poolId;
        int24 tickLower;
        int24 tickUpper;
        uint64 lockedAt;
    }

    address public immutable owner;
    IUniswapV4PositionManager public immutable positionManager;
    IUniswapV4StateView public immutable stateView;
    IPermit2AllowanceTransfer public immutable permit2;
    IStockPoolInitializationGuard public immutable hook;
    address public factory;
    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;

    event FactoryConfigured(address indexed factory);
    event StockLiquidityLocked(
        bytes32 indexed positionId,
        bytes32 indexed poolId,
        uint256 indexed launchId,
        address token,
        address quoteToken,
        address creator,
        uint256 tokenAmount
    );

    constructor(
        address owner_,
        IUniswapV4PositionManager positionManager_,
        IUniswapV4StateView stateView_,
        IPermit2AllowanceTransfer permit2_,
        IStockPoolInitializationGuard hook_
    ) {
        if (
            owner_ == address(0) || address(positionManager_) == address(0) || address(stateView_) == address(0)
                || address(permit2_) == address(0) || address(hook_) == address(0)
        ) revert InvalidAddress();
        if ((uint160(address(hook_)) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS) revert InvalidAddress();
        owner = owner_;
        positionManager = positionManager_;
        stateView = stateView_;
        permit2 = permit2_;
        hook = hook_;
    }

    function setFactory(address factory_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert AlreadyConfigured();
        if (factory_ == address(0)) revert InvalidAddress();
        factory = factory_;
        emit FactoryConfigured(factory_);
    }

    function lockTokenOnlyLiquidity(
        uint256 launchId,
        address token,
        address quoteToken,
        uint256 tokenAmount,
        address creator,
        PoolConfig calldata config
    ) external nonReentrant returns (bytes32 positionId, bytes32 poolId) {
        if (msg.sender != factory) revert NotFactory();
        if (token == address(0) || quoteToken == address(0) || token == quoteToken || creator == address(0)) {
            revert InvalidAddress();
        }
        _validateConfig(config);
        bool tokenIsCurrency0 = token < quoteToken;
        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: tokenIsCurrency0 ? token : quoteToken,
            currency1: tokenIsCurrency0 ? quoteToken : token,
            fee: DYNAMIC_FEE_FLAG,
            tickSpacing: config.tickSpacing,
            hooks: address(hook)
        });
        poolId = keccak256(abi.encode(pool));
        _ensurePool(pool, poolId, config.initialSqrtPriceX96, token, quoteToken, creator);

        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(config.tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(config.tickUpper);
        uint128 liquidity = tokenIsCurrency0
            ? _liquidityForAmount0(sqrtLower, sqrtUpper, tokenAmount)
            : _liquidityForAmount1(sqrtLower, sqrtUpper, tokenAmount);
        if (liquidity == 0) revert ZeroLiquidity();

        uint256 tokenId = positionManager.nextTokenId();
        if (!IERC20Minimal(token).approve(address(permit2), tokenAmount)) revert TokenApprovalFailed();
        permit2.approve(token, address(positionManager), uint160(tokenAmount), type(uint48).max);
        bytes memory actions = abi.encodePacked(ACTION_MINT_POSITION, ACTION_SETTLE_PAIR, ACTION_SWEEP, ACTION_SWEEP);
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            pool,
            config.tickLower,
            config.tickUpper,
            liquidity,
            tokenIsCurrency0 ? tokenAmount : 0,
            tokenIsCurrency0 ? 0 : tokenAmount,
            address(this),
            bytes("")
        );
        params[1] = abi.encode(pool.currency0, pool.currency1);
        params[2] = abi.encode(pool.currency0, address(this));
        params[3] = abi.encode(pool.currency1, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + 30 minutes);
        uint128 mintedLiquidity = positionManager.getPositionLiquidity(tokenId);
        if (mintedLiquidity == 0) revert PositionMintFailed();
        positionId = bytes32(tokenId);
        lockedPositions[positionId] = LockedPosition({
            launchId: launchId,
            token: token,
            quoteToken: quoteToken,
            creator: creator,
            tokenId: tokenId,
            liquidity: mintedLiquidity,
            tokenAmount: tokenAmount,
            poolId: poolId,
            tickLower: config.tickLower,
            tickUpper: config.tickUpper,
            lockedAt: uint64(block.timestamp)
        });
        emit StockLiquidityLocked(positionId, poolId, launchId, token, quoteToken, creator, tokenAmount);
    }

    function _ensurePool(
        IUniswapV4PositionManager.PoolKey memory pool,
        bytes32 poolId,
        uint160 sqrtPriceX96,
        address token,
        address quoteToken,
        address creator
    ) private {
        try stateView.getSlot0(poolId) returns (uint160 existingSqrtPrice, int24, uint24, uint24) {
            if (existingSqrtPrice != 0) revert InvalidPoolState();
        } catch {}
        hook.authorizePool(poolId, sqrtPriceX96, token, quoteToken, creator);
        positionManager.initializePool(pool, sqrtPriceX96);
        (uint160 current,,,) = stateView.getSlot0(poolId);
        if (current != sqrtPriceX96) revert InvalidPoolState();
    }

    function _validateConfig(PoolConfig calldata config) private pure {
        if (
            config.tickSpacing <= 0 || config.tickSpacing > TickMath.MAX_TICK_SPACING
                || config.tickLower >= config.tickUpper || config.tickLower % config.tickSpacing != 0
                || config.tickUpper % config.tickSpacing != 0 || config.tickLower < TickMath.MIN_TICK
                || config.tickUpper > TickMath.MAX_TICK || config.initialSqrtPriceX96 == 0
        ) revert InvalidConfig();
        uint160 lower = TickMath.getSqrtPriceAtTick(config.tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(config.tickUpper);
        if (config.initialSqrtPriceX96 != lower && config.initialSqrtPriceX96 != upper) revert InvalidConfig();
    }

    function _liquidityForAmount0(uint160 sqrtPriceA, uint160 sqrtPriceB, uint256 amount0)
        private
        pure
        returns (uint128)
    {
        uint256 intermediate = FullMath.mulDiv(sqrtPriceA, sqrtPriceB, Q96);
        uint256 value = FullMath.mulDiv(amount0, intermediate, uint256(sqrtPriceB) - sqrtPriceA);
        if (value > type(uint128).max) revert InvalidConfig();
        return uint128(value);
    }

    function _liquidityForAmount1(uint160 sqrtPriceA, uint160 sqrtPriceB, uint256 amount1)
        private
        pure
        returns (uint128)
    {
        uint256 value = FullMath.mulDiv(amount1, Q96, uint256(sqrtPriceB) - sqrtPriceA);
        if (value > type(uint128).max) revert InvalidConfig();
        return uint128(value);
    }
}
