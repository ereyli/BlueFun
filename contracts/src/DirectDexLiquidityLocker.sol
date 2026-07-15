// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "./UniswapV4LiquidityLocker.sol";
import {FullMath} from "./libraries/FullMath.sol";
import {TickMath} from "./libraries/TickMath.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

interface IPoolInitializationGuard {
    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96) external;
}

/// @notice Creates token-only Uniswap v4 launch positions and permanently custody-locks the position NFT.
/// @dev There is deliberately no principal withdrawal or NFT transfer function. Only zero-liquidity-delta fee
///      collection is exposed.
contract DirectDexLiquidityLocker is ReentrancyGuard {
    error NotFactory();
    error NotOwner();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidConfig();
    error InvalidPoolState();
    error ZeroAmount();
    error ZeroLiquidity();
    error PositionMintFailed();
    error PositionNotFound();
    error TokenApprovalFailed();
    error TokenTransferFailed();
    error NoFeesCollected();
    error LiquidityChanged();
    error FeeClaimFailed();
    error ExcessTokenResidual();

    uint256 private constant Q96 = 0x1000000000000000000000000;
    uint8 private constant ACTION_DECREASE_LIQUIDITY = 0x01;
    uint8 private constant ACTION_MINT_POSITION = 0x02;
    uint8 private constant ACTION_SETTLE_PAIR = 0x0d;
    uint8 private constant ACTION_TAKE_PAIR = 0x11;
    uint8 private constant ACTION_SWEEP = 0x14;
    uint16 public constant SHARE_BPS = 10_000;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant BEFORE_INITIALIZE_FLAG = 1 << 13;

    struct PoolConfig {
        uint24 poolFee;
        int24 tickSpacing;
        int24 tickLower;
        int24 tickUpper;
        uint160 initialSqrtPriceX96;
        uint16 platformShareBps;
        uint16 creatorShareBps;
    }

    struct LockedPosition {
        uint256 launchId;
        address token;
        address creator;
        uint256 tokenId;
        uint128 liquidity;
        uint256 tokenAmountMax;
        bytes32 poolId;
        uint24 poolFee;
        int24 tickLower;
        int24 tickUpper;
        uint16 platformShareBps;
        uint16 creatorShareBps;
        uint64 lockedAt;
    }

    struct FeeRevenue {
        uint256 nativeCollected;
        uint256 tokenCollected;
        uint256 platformNative;
        uint256 platformToken;
        uint256 creatorNative;
        uint256 creatorToken;
    }

    address public immutable owner;
    address public immutable platformFeeRecipient;
    IUniswapV4PositionManager public immutable positionManager;
    IUniswapV4StateView public immutable stateView;
    IPermit2AllowanceTransfer public immutable permit2;
    IPoolInitializationGuard public immutable initializationGuard;
    address public factory;

    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;
    mapping(bytes32 positionId => FeeRevenue revenue) public feeRevenue;
    mapping(address account => mapping(address currency => uint256 amount)) public pendingFees;

    event FactoryConfigured(address indexed factory);
    event DirectLiquidityLocked(
        bytes32 indexed positionId,
        bytes32 indexed poolId,
        uint256 indexed launchId,
        address token,
        address creator,
        uint256 tokenAmount,
        uint24 poolFee
    );
    event PositionFeesCollected(
        bytes32 indexed positionId,
        address indexed token,
        address indexed creator,
        uint256 nativeAmount,
        uint256 tokenAmount,
        uint256 platformNative,
        uint256 platformToken,
        uint256 creatorNative,
        uint256 creatorToken
    );
    event FeesClaimed(address indexed account, address indexed currency, uint256 amount);

    constructor(
        address owner_,
        address platformFeeRecipient_,
        IUniswapV4PositionManager positionManager_,
        IUniswapV4StateView stateView_,
        IPermit2AllowanceTransfer permit2_,
        IPoolInitializationGuard initializationGuard_
    ) {
        if (
            owner_ == address(0) || platformFeeRecipient_ == address(0) || address(positionManager_) == address(0)
                || address(stateView_) == address(0) || address(permit2_) == address(0)
                || address(initializationGuard_) == address(0)
        ) revert InvalidAddress();
        if ((uint160(address(initializationGuard_)) & ALL_HOOK_MASK) != BEFORE_INITIALIZE_FLAG) {
            revert InvalidAddress();
        }
        owner = owner_;
        platformFeeRecipient = platformFeeRecipient_;
        positionManager = positionManager_;
        stateView = stateView_;
        permit2 = permit2_;
        initializationGuard = initializationGuard_;
    }

    receive() external payable {}

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
        uint256 tokenAmount,
        address creator,
        PoolConfig calldata config
    ) external nonReentrant returns (bytes32 positionId, bytes32 poolId) {
        if (msg.sender != factory) revert NotFactory();
        if (token == address(0) || creator == address(0)) revert InvalidAddress();
        if (tokenAmount == 0) revert ZeroAmount();
        _validateConfig(config);

        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: address(0),
            currency1: token,
            fee: config.poolFee,
            tickSpacing: config.tickSpacing,
            hooks: address(initializationGuard)
        });
        poolId = keccak256(abi.encode(pool));
        _ensurePool(pool, poolId, config.initialSqrtPriceX96);

        uint160 rangeLowerSqrtPriceX96 = TickMath.getSqrtPriceAtTick(config.tickLower);
        uint160 rangeUpperSqrtPriceX96 = TickMath.getSqrtPriceAtTick(config.tickUpper);
        uint128 liquidity = _liquidityForAmount1(rangeLowerSqrtPriceX96, rangeUpperSqrtPriceX96, tokenAmount);
        if (liquidity == 0) revert ZeroLiquidity();
        uint256 rangeDelta = uint256(rangeUpperSqrtPriceX96) - rangeLowerSqrtPriceX96;
        uint256 tokenRequired = FullMath.mulDiv(liquidity, rangeDelta, Q96);
        if (mulmod(liquidity, rangeDelta, Q96) > 0) ++tokenRequired;
        uint256 maximumRoundingResidual = rangeDelta / Q96 + 2;
        if (tokenAmount - tokenRequired > maximumRoundingResidual) revert ExcessTokenResidual();

        uint256 tokenId = positionManager.nextTokenId();
        if (!IERC20Minimal(token).approve(address(permit2), tokenAmount)) revert TokenApprovalFailed();
        permit2.approve(token, address(positionManager), uint160(tokenAmount), type(uint48).max);

        bytes memory actions = abi.encodePacked(ACTION_MINT_POSITION, ACTION_SETTLE_PAIR, ACTION_SWEEP, ACTION_SWEEP);
        bytes[] memory params = new bytes[](4);
        params[0] =
            abi.encode(pool, config.tickLower, config.tickUpper, liquidity, 0, tokenAmount, address(this), bytes(""));
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
            creator: creator,
            tokenId: tokenId,
            liquidity: mintedLiquidity,
            tokenAmountMax: tokenAmount,
            poolId: poolId,
            poolFee: config.poolFee,
            tickLower: config.tickLower,
            tickUpper: config.tickUpper,
            platformShareBps: config.platformShareBps,
            creatorShareBps: config.creatorShareBps,
            lockedAt: uint64(block.timestamp)
        });

        emit DirectLiquidityLocked(positionId, poolId, launchId, token, creator, tokenAmount, config.poolFee);
    }

    /// @notice Realizes fees while proving that the permanently locked liquidity principal did not change.
    function collectFees(bytes32 positionId) external nonReentrant returns (uint256 nativeAmount, uint256 tokenAmount) {
        LockedPosition storage position = lockedPositions[positionId];
        if (position.token == address(0)) revert PositionNotFound();

        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = IERC20Minimal(position.token).balanceOf(address(this));
        uint128 liquidityBefore = positionManager.getPositionLiquidity(position.tokenId);

        bytes memory actions = abi.encodePacked(ACTION_DECREASE_LIQUIDITY, ACTION_TAKE_PAIR);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(position.tokenId, 0, 0, 0, bytes(""));
        params[1] = abi.encode(address(0), position.token, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + 30 minutes);

        uint128 liquidityAfter = positionManager.getPositionLiquidity(position.tokenId);
        if (liquidityAfter != liquidityBefore || liquidityAfter != position.liquidity) revert LiquidityChanged();

        nativeAmount = address(this).balance - nativeBefore;
        tokenAmount = IERC20Minimal(position.token).balanceOf(address(this)) - tokenBefore;
        if (nativeAmount == 0 && tokenAmount == 0) revert NoFeesCollected();

        uint256 platformNative = (nativeAmount * position.platformShareBps) / SHARE_BPS;
        uint256 platformToken = (tokenAmount * position.platformShareBps) / SHARE_BPS;
        uint256 creatorNative = nativeAmount - platformNative;
        uint256 creatorToken = tokenAmount - platformToken;

        pendingFees[platformFeeRecipient][address(0)] += platformNative;
        pendingFees[platformFeeRecipient][position.token] += platformToken;
        pendingFees[position.creator][address(0)] += creatorNative;
        pendingFees[position.creator][position.token] += creatorToken;

        FeeRevenue storage revenue = feeRevenue[positionId];
        revenue.nativeCollected += nativeAmount;
        revenue.tokenCollected += tokenAmount;
        revenue.platformNative += platformNative;
        revenue.platformToken += platformToken;
        revenue.creatorNative += creatorNative;
        revenue.creatorToken += creatorToken;

        emit PositionFeesCollected(
            positionId,
            position.token,
            position.creator,
            nativeAmount,
            tokenAmount,
            platformNative,
            platformToken,
            creatorNative,
            creatorToken
        );
    }

    function claimFees(address currency) external nonReentrant returns (uint256 amount) {
        amount = pendingFees[msg.sender][currency];
        if (amount == 0) revert NoFeesCollected();
        pendingFees[msg.sender][currency] = 0;
        if (currency == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert FeeClaimFailed();
        } else if (!IERC20Minimal(currency).transfer(msg.sender, amount)) {
            revert TokenTransferFailed();
        }
        emit FeesClaimed(msg.sender, currency, amount);
    }

    function _ensurePool(IUniswapV4PositionManager.PoolKey memory pool, bytes32 poolId, uint160 expectedSqrtPriceX96)
        private
    {
        try stateView.getSlot0(poolId) returns (uint160 current, int24, uint24, uint24) {
            if (current != 0) {
                if (current != expectedSqrtPriceX96) revert InvalidPoolState();
                return;
            }
        } catch {}
        initializationGuard.authorizePool(poolId, expectedSqrtPriceX96);
        try positionManager.initializePool(pool, expectedSqrtPriceX96) returns (int24) {
            (uint160 current,,,) = stateView.getSlot0(poolId);
            if (current != expectedSqrtPriceX96) revert InvalidPoolState();
        }
        catch {
            (uint160 current,,,) = stateView.getSlot0(poolId);
            if (current != expectedSqrtPriceX96) revert InvalidPoolState();
        }
    }

    function _validateConfig(PoolConfig calldata config) private pure {
        if (
            config.poolFee == 0 || config.tickSpacing <= 0 || config.tickLower >= config.tickUpper
                || config.tickLower % config.tickSpacing != 0 || config.tickUpper % config.tickSpacing != 0
                || config.tickSpacing > TickMath.MAX_TICK_SPACING || config.tickLower < TickMath.MIN_TICK
                || config.tickUpper > TickMath.MAX_TICK
                || config.initialSqrtPriceX96 < TickMath.getSqrtPriceAtTick(config.tickUpper)
                || config.platformShareBps + config.creatorShareBps != SHARE_BPS
        ) revert InvalidConfig();
    }

    function _liquidityForAmount1(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint256 amount1)
        private
        pure
        returns (uint128)
    {
        uint256 value = FullMath.mulDiv(amount1, Q96, sqrtPriceBX96 - sqrtPriceAX96);
        if (value > type(uint128).max) revert InvalidConfig();
        return uint128(value);
    }
}
