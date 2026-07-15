// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ILiquidityLocker} from "./interfaces/ILiquidityLocker.sol";
import {FullMath} from "./libraries/FullMath.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

interface IERC20Minimal {
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
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

interface IUniswapV4StateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface IBondPoolInitializationGuard {
    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96, address token, address creator) external;
}

contract UniswapV4LiquidityLocker is ILiquidityLocker, ReentrancyGuard {
    using FullMath for uint256;

    error NotGraduationManager();
    error ZeroAmount();
    error InvalidAddress();
    error InvalidPoolConfig();
    error ZeroLiquidity();
    error PositionMintFailed();
    error NotOwner();
    error AlreadyConfigured();
    error TokenApprovalFailed();
    error TokenTransferFailed();
    error NoUsablePool();
    error PositionNotFound();
    error NoFeesCollected();
    error LiquidityChanged();
    error FeeClaimFailed();

    uint256 private constant Q96 = 0x1000000000000000000000000;
    uint256 private constant Q192 = 0x1000000000000000000000000000000000000000000000000;
    uint160 private constant MIN_SQRT_PRICE = 4295128739;
    uint160 private constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;
    int24 private constant MIN_TICK_60 = -887220;
    int24 private constant MAX_TICK_60 = 887220;

    uint8 private constant ACTION_MINT_POSITION = 0x02;
    uint8 private constant ACTION_DECREASE_LIQUIDITY = 0x01;
    uint8 private constant ACTION_SETTLE_PAIR = 0x0d;
    uint8 private constant ACTION_TAKE_PAIR = 0x11;
    uint8 private constant ACTION_SWEEP = 0x14;
    uint256 private constant POOL_PRICE_TOLERANCE_BPS = 100;
    uint256 public constant FEE_SPLIT_BPS = 10_000;
    uint256 public constant PLATFORM_SHARE_BPS = 7_000;
    uint256 public constant CREATOR_SHARE_BPS = 3_000;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant UNIFIED_FEE_HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);
    uint160 private constant LEGACY_INITIALIZATION_FLAGS = 1 << 13;
    uint24 private constant DYNAMIC_FEE_FLAG = 0x800000;

    address public immutable owner;
    address public immutable platformFeeRecipient;
    address public graduationManager;
    IUniswapV4PositionManager public immutable positionManager;
    IUniswapV4StateView public immutable stateView;
    IPermit2AllowanceTransfer public immutable permit2;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    address public immutable hooks;

    struct LockedPosition {
        uint256 launchId;
        address token;
        uint256 tokenAmountMax;
        uint256 ethAmountMax;
        address creator;
        uint256 tokenId;
        uint128 liquidity;
        uint160 sqrtPriceX96;
        uint24 poolFee;
        uint64 lockedAt;
    }

    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;
    mapping(address account => mapping(address currency => uint256 amount)) public pendingFees;

    struct FeeRevenue {
        uint256 nativeCollected;
        uint256 tokenCollected;
        uint256 platformNative;
        uint256 platformToken;
        uint256 creatorNative;
        uint256 creatorToken;
    }

    mapping(bytes32 positionId => FeeRevenue revenue) public feeRevenue;

    event LiquidityPositionLocked(
        bytes32 indexed positionId,
        uint256 indexed launchId,
        address indexed token,
        uint256 tokenAmount,
        uint256 ethAmount
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
        uint24 poolFee_,
        int24 tickSpacing_,
        address hooks_
    ) {
        if (
            owner_ == address(0) || platformFeeRecipient_ == address(0) || address(positionManager_) == address(0)
                || address(stateView_) == address(0) || address(permit2_) == address(0)
        ) revert InvalidAddress();
        if (
            (poolFee_ != DYNAMIC_FEE_FLAG && poolFee_ == 0) || tickSpacing_ != 60
                || (
                    (uint160(hooks_) & ALL_HOOK_MASK) != UNIFIED_FEE_HOOK_FLAGS
                        && (uint160(hooks_) & ALL_HOOK_MASK) != LEGACY_INITIALIZATION_FLAGS
                )
        ) revert InvalidPoolConfig();
        owner = owner_;
        platformFeeRecipient = platformFeeRecipient_;
        positionManager = positionManager_;
        stateView = stateView_;
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

    function lockLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        payable
        returns (bytes32 positionId)
    {
        if (msg.sender != graduationManager) revert NotGraduationManager();
        if (token == address(0) || creator == address(0) || tokenAmount == 0 || msg.value == 0) revert ZeroAmount();

        uint160 sqrtPriceX96 = _sqrtPriceX96(tokenAmount, msg.value);
        uint128 liquidity = _liquidityForAmounts(sqrtPriceX96, msg.value, tokenAmount);
        if (liquidity == 0) revert ZeroLiquidity();

        IUniswapV4PositionManager.PoolKey memory pool = _selectPool(token, creator, sqrtPriceX96);

        uint256 tokenId = positionManager.nextTokenId();
        if (!IERC20Minimal(token).approve(address(permit2), tokenAmount)) revert TokenApprovalFailed();
        permit2.approve(token, address(positionManager), uint160(tokenAmount), type(uint48).max);

        bytes memory actions = abi.encodePacked(ACTION_MINT_POSITION, ACTION_SETTLE_PAIR, ACTION_SWEEP, ACTION_SWEEP);
        bytes[] memory params = new bytes[](4);
        params[0] =
            abi.encode(pool, MIN_TICK_60, MAX_TICK_60, liquidity, msg.value, tokenAmount, address(this), bytes(""));
        params[1] = abi.encode(pool.currency0, pool.currency1);
        params[2] = abi.encode(pool.currency0, address(this));
        params[3] = abi.encode(pool.currency1, address(this));

        positionManager.modifyLiquidities{value: msg.value}(abi.encode(actions, params), block.timestamp + 30 minutes);
        uint128 mintedLiquidity = positionManager.getPositionLiquidity(tokenId);
        if (mintedLiquidity == 0) revert PositionMintFailed();

        positionId = bytes32(tokenId);
        lockedPositions[positionId] = LockedPosition({
            launchId: launchId,
            token: token,
            tokenAmountMax: tokenAmount,
            ethAmountMax: msg.value,
            creator: creator,
            tokenId: tokenId,
            liquidity: mintedLiquidity,
            sqrtPriceX96: sqrtPriceX96,
            poolFee: pool.fee,
            lockedAt: uint64(block.timestamp)
        });

        emit LiquidityPositionLocked(positionId, launchId, token, tokenAmount, msg.value);
    }

    /// @notice Realizes Uniswap v4 fees without decreasing the locked position's liquidity.
    /// @dev Permissionless so a keeper or either beneficiary can trigger accounting.
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

        uint256 platformNative = (nativeAmount * PLATFORM_SHARE_BPS) / FEE_SPLIT_BPS;
        uint256 platformToken = (tokenAmount * PLATFORM_SHARE_BPS) / FEE_SPLIT_BPS;
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

    function _selectPool(address token, address creator, uint160 expectedSqrtPriceX96)
        private
        returns (IUniswapV4PositionManager.PoolKey memory selectedPool)
    {
        if (poolFee != DYNAMIC_FEE_FLAG) {
            for (uint256 i; i < 4; ++i) {
                IUniswapV4PositionManager.PoolKey memory candidate = IUniswapV4PositionManager.PoolKey({
                    currency0: address(0),
                    currency1: token,
                    fee: _candidateFee(i),
                    tickSpacing: tickSpacing,
                    hooks: hooks
                });
                bytes32 candidateId = _poolId(candidate);
                (bool exists, uint160 price) = _poolSqrtPrice(candidate);
                if (exists) {
                    if (_priceWithinTolerance(price, expectedSqrtPriceX96)) return candidate;
                    continue;
                }
                IBondPoolInitializationGuard(hooks).authorizePool(
                    candidateId, expectedSqrtPriceX96, token, creator
                );
                try positionManager.initializePool(candidate, expectedSqrtPriceX96) returns (int24) {
                    (exists, price) = _poolSqrtPrice(candidate);
                    if (exists && _priceWithinTolerance(price, expectedSqrtPriceX96)) return candidate;
                } catch {
                    (exists, price) = _poolSqrtPrice(candidate);
                    if (exists && _priceWithinTolerance(price, expectedSqrtPriceX96)) return candidate;
                }
            }
            revert NoUsablePool();
        }
        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: address(0), currency1: token, fee: poolFee, tickSpacing: tickSpacing, hooks: hooks
        });
        bytes32 poolId = _poolId(pool);
        (bool initialized, uint160 currentSqrtPriceX96) = _poolSqrtPrice(pool);
        if (initialized) {
            if (_priceWithinTolerance(currentSqrtPriceX96, expectedSqrtPriceX96)) return pool;
            revert NoUsablePool();
        }
        IBondPoolInitializationGuard(hooks).authorizePool(poolId, expectedSqrtPriceX96, token, creator);
        try positionManager.initializePool(pool, expectedSqrtPriceX96) returns (int24) {
            (initialized, currentSqrtPriceX96) = _poolSqrtPrice(pool);
            if (initialized && _priceWithinTolerance(currentSqrtPriceX96, expectedSqrtPriceX96)) return pool;
        } catch {
            (initialized, currentSqrtPriceX96) = _poolSqrtPrice(pool);
            if (initialized && _priceWithinTolerance(currentSqrtPriceX96, expectedSqrtPriceX96)) return pool;
        }
        revert NoUsablePool();
    }

    function _candidateFee(uint256 index) private view returns (uint24) {
        if (index == 0) return poolFee;
        if (index == 1 && poolFee != 10_000) return 10_000;
        if (index == 2 && poolFee != 500) return 500;
        if (index == 3 && poolFee != 100) return 100;
        return 3_000;
    }

    function _poolSqrtPrice(IUniswapV4PositionManager.PoolKey memory pool)
        private
        view
        returns (bool initialized, uint160 sqrtPriceX96)
    {
        try stateView.getSlot0(_poolId(pool)) returns (uint160 current, int24, uint24, uint24) {
            return (current != 0, current);
        } catch {
            return (false, 0);
        }
    }

    function _poolId(IUniswapV4PositionManager.PoolKey memory pool) private pure returns (bytes32) {
        return keccak256(abi.encode(pool));
    }

    function _priceWithinTolerance(uint160 actual, uint160 expected) private pure returns (bool) {
        uint160 lower = uint160((uint256(expected) * (10_000 - POOL_PRICE_TOLERANCE_BPS)) / 10_000);
        uint160 upper = uint160((uint256(expected) * (10_000 + POOL_PRICE_TOLERANCE_BPS)) / 10_000);
        return actual >= lower && actual <= upper;
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
