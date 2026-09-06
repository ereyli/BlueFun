// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StockQuoteRegistry} from "./StockQuoteRegistry.sol";
import {StockLiquidityLocker} from "./StockLiquidityLocker.sol";
import {IERC20Minimal, IPermit2AllowanceTransfer, IUniswapV4PositionManager} from "../UniswapV4LiquidityLocker.sol";
import {FullMath} from "../libraries/FullMath.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {Ownable} from "../access/Ownable.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";

interface IERC20StockQuote is IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IStockInitialBuyRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Stock-quoted Direct launch factory shared by Base B20 and Robinhood ERC-20 variants.
abstract contract StockDirectLaunchFactoryBase is Ownable, ReentrancyGuard {
    error InvalidLaunchConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee();
    error SaltAlreadyUsed();
    error DeadlineExpired();
    error LaunchConfigChanged();
    error LaunchRouterAlreadyConfigured();
    error LaunchRouterNotConfigured();
    error InitialBuyFailed();
    error InitialBuyExceedsFivePercent();
    error TokenTransferFailed();
    error LaunchesPaused();
    error PriceMoved();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant SUPPLY_UNITS = 1_000_000_000;
    uint256 public constant MAX_INITIAL_BUY_TOKENS = MAX_SUPPLY / 20;
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    uint256 private constant Q96 = 0x1000000000000000000000000;
    uint256 private constant WAD = 1e18;

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    struct LaunchConfig {
        int24 tickSpacing;
        int24 rangeWidthTicks;
        uint256 targetFdvUsd18;
    }

    struct PriceProof {
        uint256 attestedPrice18;
        uint64 validUntil;
        bytes signature;
    }

    StockLiquidityLocker public immutable liquidityLocker;
    StockQuoteRegistry public immutable quoteRegistry;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    IPermit2AllowanceTransfer public immutable permit2;
    LaunchConfig public launchConfig;
    address public launchRouter;
    uint256 public launchCount;
    mapping(bytes32 salt => bool used) public usedSalts;

    event StockDirectLaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address quoteToken,
        bytes32 poolId,
        bytes32 positionId,
        uint160 initialSqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 stockPriceUsd18,
        string name,
        string symbol,
        string contractURI
    );
    event StockLaunchConfigUpdated(int24 tickSpacing, int24 rangeWidthTicks, uint256 targetFdvUsd18);
    event LaunchRouterConfigured(address indexed router);
    event CreatorInitialStockBuy(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address quoteToken,
        uint256 quoteAmount,
        uint256 tokenAmount
    );

    constructor(
        address initialOwner,
        StockLiquidityLocker liquidityLocker_,
        StockQuoteRegistry quoteRegistry_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_,
        IPermit2AllowanceTransfer permit2_,
        LaunchConfig memory initialConfig
    ) Ownable(initialOwner) {
        if (
            address(liquidityLocker_) == address(0) || address(quoteRegistry_) == address(0)
                || address(feePolicy_) == address(0) || address(revenueRouter_) == address(0)
                || address(permit2_) == address(0)
        ) revert InvalidLaunchConfig();
        liquidityLocker = liquidityLocker_;
        quoteRegistry = quoteRegistry_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
        permit2 = permit2_;
        _setLaunchConfig(initialConfig);
    }

    function createLaunch(
        TokenMetadata calldata metadata,
        address quoteToken,
        bytes32 expectedConfigHash,
        uint256 minimumStockPrice18,
        uint256 maximumStockPrice18,
        PriceProof calldata priceProof,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        return _createLaunch(
            metadata,
            quoteToken,
            expectedConfigHash,
            minimumStockPrice18,
            maximumStockPrice18,
            priceProof,
            deadline,
            0,
            0
        );
    }

    function createLaunchWithInitialBuy(
        TokenMetadata calldata metadata,
        address quoteToken,
        bytes32 expectedConfigHash,
        uint256 minimumStockPrice18,
        uint256 maximumStockPrice18,
        PriceProof calldata priceProof,
        uint256 deadline,
        uint256 quoteAmount,
        uint256 minimumTokensOut
    ) external payable nonReentrant returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (quoteAmount == 0 || launchRouter == address(0)) revert LaunchRouterNotConfigured();
        return _createLaunch(
            metadata,
            quoteToken,
            expectedConfigHash,
            minimumStockPrice18,
            maximumStockPrice18,
            priceProof,
            deadline,
            quoteAmount,
            minimumTokensOut
        );
    }

    function _createLaunch(
        TokenMetadata calldata metadata,
        address quoteToken,
        bytes32 expectedConfigHash,
        uint256 minimumStockPrice18,
        uint256 maximumStockPrice18,
        PriceProof calldata priceProof,
        uint256 deadline,
        uint256 initialQuoteAmount,
        uint256 minimumTokensOut
    ) private returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (expectedConfigHash != launchConfigHash()) revert LaunchConfigChanged();
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40 || bytes(metadata.symbol).length == 0
                || bytes(metadata.symbol).length > 10 || bytes(metadata.contractURI).length == 0
        ) revert InvalidMetadata();
        uint256 requiredLaunchFee = feePolicy.launchFee();
        if (msg.value != requiredLaunchFee) revert InsufficientLaunchFee();
        uint256 stockPrice18 = quoteRegistry.validatedPrice18(
            quoteToken, priceProof.attestedPrice18, priceProof.validUntil, priceProof.signature
        );
        if (
            minimumStockPrice18 == 0 || maximumStockPrice18 < minimumStockPrice18 || stockPrice18 < minimumStockPrice18
                || stockPrice18 > maximumStockPrice18
        ) revert PriceMoved();
        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, quoteToken, metadata.salt));
        if (usedSalts[effectiveSalt]) revert SaltAlreadyUsed();
        usedSalts[effectiveSalt] = true;
        launchId = ++launchCount;
        token = _deployToken(metadata, effectiveSalt, MAX_SUPPLY, address(liquidityLocker));
        (StockLiquidityLocker.PoolConfig memory poolConfig, bool tokenIsCurrency0) =
            _poolConfig(token, quoteToken, stockPrice18);
        (positionId, poolId) =
            liquidityLocker.lockTokenOnlyLiquidity(launchId, token, quoteToken, MAX_SUPPLY, msg.sender, poolConfig);
        if (requiredLaunchFee != 0) revenueRouter.depositLaunchRevenue{value: requiredLaunchFee}();
        if (initialQuoteAmount != 0) {
            uint256 bought = _executeInitialBuy(
                token, quoteToken, poolConfig, tokenIsCurrency0, initialQuoteAmount, minimumTokensOut
            );
            if (bought > MAX_INITIAL_BUY_TOKENS) revert InitialBuyExceedsFivePercent();
            if (!IERC20Minimal(token).transfer(msg.sender, bought)) revert TokenTransferFailed();
            emit CreatorInitialStockBuy(launchId, token, msg.sender, quoteToken, initialQuoteAmount, bought);
        }
        emit StockDirectLaunchCreated(
            launchId,
            token,
            msg.sender,
            quoteToken,
            poolId,
            positionId,
            poolConfig.initialSqrtPriceX96,
            poolConfig.tickLower,
            poolConfig.tickUpper,
            stockPrice18,
            metadata.name,
            metadata.symbol,
            metadata.contractURI
        );
    }

    function _poolConfig(address token, address quoteToken, uint256 stockPrice18)
        private
        view
        returns (StockLiquidityLocker.PoolConfig memory config, bool tokenIsCurrency0)
    {
        LaunchConfig memory launch = launchConfig;
        tokenIsCurrency0 = token < quoteToken;
        uint256 ratioX18 = tokenIsCurrency0
            ? FullMath.mulDiv(launch.targetFdvUsd18, WAD, stockPrice18 * SUPPLY_UNITS)
            : FullMath.mulDiv(stockPrice18, SUPPLY_UNITS * WAD, launch.targetFdvUsd18);
        uint256 sqrtRatioX9 = _sqrt(ratioX18);
        uint256 desired = FullMath.mulDiv(sqrtRatioX9, Q96, 1e9);
        if (desired > type(uint160).max) revert InvalidLaunchConfig();
        int24 rawTick = TickMath.getTickAtSqrtPrice(uint160(desired));
        int24 edge = tokenIsCurrency0 ? _ceilTick(rawTick, launch.tickSpacing) : _floorTick(rawTick, launch.tickSpacing);
        int24 tickLower = tokenIsCurrency0 ? edge : edge - launch.rangeWidthTicks;
        int24 tickUpper = tokenIsCurrency0 ? edge + launch.rangeWidthTicks : edge;
        if (tickLower < TickMath.MIN_TICK || tickUpper > TickMath.MAX_TICK) revert InvalidLaunchConfig();
        config = StockLiquidityLocker.PoolConfig({
            tickSpacing: launch.tickSpacing,
            tickLower: tickLower,
            tickUpper: tickUpper,
            initialSqrtPriceX96: TickMath.getSqrtPriceAtTick(edge)
        });
    }

    function _executeInitialBuy(
        address token,
        address quoteToken,
        StockLiquidityLocker.PoolConfig memory config,
        bool tokenIsCurrency0,
        uint256 quoteAmount,
        uint256 minimumTokensOut
    ) private returns (uint256 bought) {
        if (quoteAmount > type(uint128).max || minimumTokensOut > type(uint128).max) {
            revert InitialBuyFailed();
        }
        if (!IERC20StockQuote(quoteToken).transferFrom(msg.sender, address(this), quoteAmount)) {
            revert TokenTransferFailed();
        }
        if (!IERC20Minimal(quoteToken).approve(address(permit2), quoteAmount)) revert TokenTransferFailed();
        permit2.approve(quoteToken, launchRouter, uint160(quoteAmount), type(uint48).max);
        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: tokenIsCurrency0 ? token : quoteToken,
            currency1: tokenIsCurrency0 ? quoteToken : token,
            fee: DYNAMIC_FEE_FLAG,
            tickSpacing: config.tickSpacing,
            hooks: address(liquidityLocker.hook())
        });
        IStockInitialBuyRouter.ExactInputSingleParams memory swap = IStockInitialBuyRouter.ExactInputSingleParams({
            poolKey: pool,
            zeroForOne: !tokenIsCurrency0,
            amountIn: uint128(quoteAmount),
            amountOutMinimum: uint128(minimumTokensOut),
            hookData: bytes("")
        });
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(swap);
        params[1] = abi.encode(quoteToken, quoteAmount);
        params[2] = abi.encode(token, minimumTokensOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(bytes(hex"060c0f"), params);
        uint256 beforeBalance = IERC20Minimal(token).balanceOf(address(this));
        IStockInitialBuyRouter(launchRouter).execute(hex"10", inputs, block.timestamp + 30 minutes);
        bought = IERC20Minimal(token).balanceOf(address(this)) - beforeBalance;
        if (bought == 0 || bought < minimumTokensOut) revert InitialBuyFailed();
    }

    function setLaunchRouter(address router) external onlyOwner {
        if (launchRouter != address(0)) revert LaunchRouterAlreadyConfigured();
        if (router == address(0)) revert InvalidLaunchConfig();
        launchRouter = router;
        emit LaunchRouterConfigured(router);
    }

    function setLaunchConfig(LaunchConfig calldata config) external onlyOwner {
        _setLaunchConfig(config);
    }

    function launchConfigHash() public view returns (bytes32) {
        return keccak256(abi.encode(launchConfig));
    }

    function launchFee() external view returns (uint256) {
        return feePolicy.launchFee();
    }

    function previewPool(address predictedToken, address quoteToken, PriceProof calldata priceProof)
        external
        view
        returns (StockLiquidityLocker.PoolConfig memory config, uint256 stockPrice18, bool tokenIsCurrency0)
    {
        stockPrice18 = quoteRegistry.validatedPrice18(
            quoteToken, priceProof.attestedPrice18, priceProof.validUntil, priceProof.signature
        );
        (config, tokenIsCurrency0) = _poolConfig(predictedToken, quoteToken, stockPrice18);
    }

    function _setLaunchConfig(LaunchConfig memory config) private {
        if (
            config.tickSpacing <= 0 || config.tickSpacing > TickMath.MAX_TICK_SPACING || config.rangeWidthTicks <= 0
                || config.rangeWidthTicks % config.tickSpacing != 0 || config.targetFdvUsd18 < 1_000 ether
                || config.targetFdvUsd18 > 25_000 ether
        ) revert InvalidLaunchConfig();
        launchConfig = config;
        emit StockLaunchConfigUpdated(config.tickSpacing, config.rangeWidthTicks, config.targetFdvUsd18);
    }

    function _floorTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 quotient = tick / spacing;
        if (tick < 0 && tick % spacing != 0) --quotient;
        return quotient * spacing;
    }

    function _ceilTick(int24 tick, int24 spacing) private pure returns (int24) {
        int24 quotient = tick / spacing;
        if (tick > 0 && tick % spacing != 0) ++quotient;
        return quotient * spacing;
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = 1;
        uint256 y = x;
        if (y >= 1 << 128) {
            y >>= 128;
            z <<= 64;
        }
        if (y >= 1 << 64) {
            y >>= 64;
            z <<= 32;
        }
        if (y >= 1 << 32) {
            y >>= 32;
            z <<= 16;
        }
        if (y >= 1 << 16) {
            y >>= 16;
            z <<= 8;
        }
        if (y >= 1 << 8) {
            y >>= 8;
            z <<= 4;
        }
        if (y >= 1 << 4) {
            y >>= 4;
            z <<= 2;
        }
        if (y >= 1 << 2) z <<= 1;
        unchecked {
            z = (z + x / z) >> 1;
            z = (z + x / z) >> 1;
            z = (z + x / z) >> 1;
            z = (z + x / z) >> 1;
            z = (z + x / z) >> 1;
            z = (z + x / z) >> 1;
            z = (z + x / z) >> 1;
            uint256 roundedDown = x / z;
            return z < roundedDown ? z : roundedDown;
        }
    }

    function _deployToken(TokenMetadata calldata metadata, bytes32 salt, uint256 supply, address recipient)
        internal
        virtual
        returns (address token);
}
