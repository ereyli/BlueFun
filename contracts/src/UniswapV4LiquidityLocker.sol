// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ILiquidityLocker} from "./interfaces/ILiquidityLocker.sol";
import {FullMath} from "./libraries/FullMath.sol";

interface IERC20Minimal {
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPermit2AllowanceTransfer {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IUniswapV4PositionManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);
    function nextTokenId() external view returns (uint256);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);
    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

contract UniswapV4LiquidityLocker is ILiquidityLocker {
    using FullMath for uint256;

    error NotGraduationManager();
    error ZeroAmount();
    error InvalidAddress();
    error InvalidPoolConfig();
    error ZeroLiquidity();
    error PositionMintFailed();
    error NotOwner();
    error AlreadyConfigured();

    uint256 private constant Q96 = 0x1000000000000000000000000;
    uint256 private constant Q192 = 0x1000000000000000000000000000000000000000000000000;
    uint160 private constant MIN_SQRT_PRICE = 4295128739;
    uint160 private constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;
    int24 private constant MIN_TICK_60 = -887220;
    int24 private constant MAX_TICK_60 = 887220;

    uint8 private constant ACTION_MINT_POSITION = 0x02;
    uint8 private constant ACTION_SETTLE_PAIR = 0x0d;
    uint8 private constant ACTION_SWEEP = 0x14;

    address public immutable owner;
    address public graduationManager;
    IUniswapV4PositionManager public immutable positionManager;
    IPermit2AllowanceTransfer public immutable permit2;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    address public immutable hooks;

    struct LockedPosition {
        uint256 launchId;
        address token;
        uint256 tokenAmountMax;
        uint256 ethAmountMax;
        uint256 tokenId;
        uint128 liquidity;
        uint160 sqrtPriceX96;
        uint64 lockedAt;
    }

    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;

    event LiquidityPositionLocked(
        bytes32 indexed positionId,
        uint256 indexed launchId,
        address indexed token,
        uint256 tokenAmount,
        uint256 ethAmount
    );

    constructor(
        address owner_,
        IUniswapV4PositionManager positionManager_,
        IPermit2AllowanceTransfer permit2_,
        uint24 poolFee_,
        int24 tickSpacing_,
        address hooks_
    ) {
        if (
            owner_ == address(0) || address(positionManager_) == address(0)
                || address(permit2_) == address(0)
        ) revert InvalidAddress();
        if (poolFee_ == 0 || tickSpacing_ != 60 || hooks_ != address(0)) revert InvalidPoolConfig();
        owner = owner_;
        positionManager = positionManager_;
        permit2 = permit2_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        hooks = hooks_;
    }

    receive() external payable {}

    function setGraduationManager(address graduationManager_) external {
        if (msg.sender != owner) revert NotOwner();
        if (graduationManager != address(0)) revert AlreadyConfigured();
        if (graduationManager_ == address(0)) revert InvalidAddress();
        graduationManager = graduationManager_;
    }

    function isDexBacked() external pure returns (bool) {
        return true;
    }

    function lockLiquidity(uint256 launchId, address token, uint256 tokenAmount)
        external
        payable
        returns (bytes32 positionId)
    {
        if (msg.sender != graduationManager) revert NotGraduationManager();
        if (token == address(0) || tokenAmount == 0 || msg.value == 0) revert ZeroAmount();

        uint160 sqrtPriceX96 = _sqrtPriceX96(tokenAmount, msg.value);
        uint128 liquidity = _liquidityForAmounts(sqrtPriceX96, msg.value, tokenAmount);
        if (liquidity == 0) revert ZeroLiquidity();

        uint256 tokenId = positionManager.nextTokenId();
        IERC20Minimal(token).approve(address(permit2), tokenAmount);
        permit2.approve(token, address(positionManager), uint160(tokenAmount), type(uint48).max);

        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: address(0),
            currency1: token,
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IUniswapV4PositionManager.initializePool, (pool, sqrtPriceX96));

        bytes memory actions =
            abi.encodePacked(ACTION_MINT_POSITION, ACTION_SETTLE_PAIR, ACTION_SWEEP, ACTION_SWEEP);
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            pool,
            MIN_TICK_60,
            MAX_TICK_60,
            liquidity,
            msg.value,
            tokenAmount,
            address(this),
            bytes("")
        );
        params[1] = abi.encode(pool.currency0, pool.currency1);
        params[2] = abi.encode(pool.currency0, address(this));
        params[3] = abi.encode(pool.currency1, address(this));

        calls[1] = abi.encodeCall(
            IUniswapV4PositionManager.modifyLiquidities,
            (abi.encode(actions, params), block.timestamp + 30 minutes)
        );

        positionManager.multicall{value: msg.value}(calls);
        uint128 mintedLiquidity = positionManager.getPositionLiquidity(tokenId);
        if (mintedLiquidity == 0) revert PositionMintFailed();

        positionId = bytes32(tokenId);
        lockedPositions[positionId] = LockedPosition({
            launchId: launchId,
            token: token,
            tokenAmountMax: tokenAmount,
            ethAmountMax: msg.value,
            tokenId: tokenId,
            liquidity: mintedLiquidity,
            sqrtPriceX96: sqrtPriceX96,
            lockedAt: uint64(block.timestamp)
        });

        emit LiquidityPositionLocked(positionId, launchId, token, tokenAmount, msg.value);
    }

    function _sqrtPriceX96(uint256 tokenAmount, uint256 ethAmount) private pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(tokenAmount, Q192, ethAmount);
        uint256 sqrtRatio = _sqrt(ratioX192);
        if (sqrtRatio <= MIN_SQRT_PRICE || sqrtRatio >= MAX_SQRT_PRICE) revert InvalidPoolConfig();
        return uint160(sqrtRatio);
    }

    function _liquidityForAmounts(uint160 sqrtPriceX96, uint256 ethAmount, uint256 tokenAmount)
        private
        pure
        returns (uint128)
    {
        uint128 liquidity0 = _liquidityForAmount0(sqrtPriceX96, MAX_SQRT_PRICE, ethAmount);
        uint128 liquidity1 = _liquidityForAmount1(MIN_SQRT_PRICE, sqrtPriceX96, tokenAmount);
        return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    }

    function _liquidityForAmount0(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint256 amount0)
        private
        pure
        returns (uint128)
    {
        uint256 intermediate = FullMath.mulDiv(sqrtPriceAX96, sqrtPriceBX96, Q96);
        return _toUint128(FullMath.mulDiv(amount0, intermediate, sqrtPriceBX96 - sqrtPriceAX96));
    }

    function _liquidityForAmount1(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint256 amount1)
        private
        pure
        returns (uint128)
    {
        return _toUint128(FullMath.mulDiv(amount1, Q96, sqrtPriceBX96 - sqrtPriceAX96));
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert InvalidPoolConfig();
        return uint128(value);
    }
}
