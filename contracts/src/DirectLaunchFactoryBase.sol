// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {DirectDexLiquidityLocker} from "./DirectDexLiquidityLocker.sol";
import {IERC20Minimal, IUniswapV4PositionManager} from "./UniswapV4LiquidityLocker.sol";
import {Ownable} from "./access/Ownable.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {IFeePolicy} from "./interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "./interfaces/IRevenueRouter.sol";

interface InitialBuyRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

abstract contract DirectLaunchFactoryBase is Ownable, ReentrancyGuard {
    error InvalidLaunchConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee();
    error LaunchFeeClaimFailed();
    error SaltAlreadyUsed();
    error DeadlineExpired();
    error LaunchConfigChanged();
    error LaunchRouterAlreadyConfigured();
    error LaunchRouterNotConfigured();
    error InitialBuyFailed();
    error InitialBuyExceedsFivePercent();
    error TokenTransferFailed();
    error LaunchesPaused();
    error AlreadySeeded();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_INITIAL_BUY_TOKENS = MAX_SUPPLY / 20; // 5%
    uint24 public constant MAX_POOL_FEE = 50_000; // 5%
    uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;
    uint256 public constant MAX_LAUNCH_FEE = 0.1 ether;

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    DirectDexLiquidityLocker public immutable liquidityLocker;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    address payable public immutable launchFeeRecipient;
    DirectDexLiquidityLocker.PoolConfig public launchConfig;
    uint256 public launchCount;
    bool public launchCountSeeded;
    uint256 public pendingLaunchFees;
    address public launchRouter;
    mapping(bytes32 salt => bool used) public usedSalts;

    event DirectLaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        bytes32 poolId,
        bytes32 positionId,
        uint24 poolFee,
        int24 tickSpacing,
        uint16 platformShareBps,
        uint16 creatorShareBps,
        string name,
        string symbol,
        string contractURI
    );
    event DirectLaunchConfigUpdated(
        uint24 poolFee,
        int24 tickSpacing,
        int24 tickLower,
        int24 tickUpper,
        uint160 initialSqrtPriceX96,
        uint16 platformShareBps,
        uint16 creatorShareBps
    );
    event DirectLaunchFeeUpdated(uint256 launchFee);
    event DirectLaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 amount);
    event DirectLaunchFeesClaimed(address indexed recipient, uint256 amount);
    event LaunchRouterConfigured(address indexed router);
    event CreatorInitialBuy(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 nativeAmount,
        uint256 tokenAmount
    );
    event LaunchCountSeeded(uint256 initialLaunchCount);

    constructor(
        address initialOwner,
        DirectDexLiquidityLocker liquidityLocker_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_,
        DirectDexLiquidityLocker.PoolConfig memory initialConfig
    ) Ownable(initialOwner) {
        if (
            address(liquidityLocker_) == address(0) || address(feePolicy_) == address(0)
                || address(revenueRouter_) == address(0)
        ) {
            revert InvalidLaunchConfig();
        }
        liquidityLocker = liquidityLocker_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
        launchFeeRecipient = payable(address(revenueRouter_));
        _setLaunchConfig(initialConfig);
    }

    function launchFee() public view returns (uint256) {
        return feePolicy.launchFee();
    }

    function seedLaunchCount(uint256 initialLaunchCount) external onlyOwner {
        if (launchCountSeeded || launchCount != 0 || initialLaunchCount == 0) revert AlreadySeeded();
        launchCountSeeded = true;
        launchCount = initialLaunchCount;
        emit LaunchCountSeeded(initialLaunchCount);
    }

    function createLaunch(TokenMetadata calldata metadata, bytes32 expectedConfigHash, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId)
    {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        return _createLaunch(metadata, expectedConfigHash, deadline, 0, 0);
    }

    function createLaunchWithInitialBuy(
        TokenMetadata calldata metadata,
        bytes32 expectedConfigHash,
        uint256 deadline,
        uint256 minimumTokensOut
    ) external payable nonReentrant returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value <= currentLaunchFee || launchRouter == address(0)) revert LaunchRouterNotConfigured();
        return _createLaunch(metadata, expectedConfigHash, deadline, msg.value - currentLaunchFee, minimumTokensOut);
    }

    function setLaunchRouter(address router) external onlyOwner {
        if (launchRouter != address(0)) revert LaunchRouterAlreadyConfigured();
        if (router == address(0)) revert InvalidLaunchConfig();
        launchRouter = router;
        emit LaunchRouterConfigured(router);
    }

    function _createLaunch(
        TokenMetadata calldata metadata,
        bytes32 expectedConfigHash,
        uint256 deadline,
        uint256 initialBuyAmount,
        uint256 minimumTokensOut
    ) private returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (expectedConfigHash != launchConfigHash()) revert LaunchConfigChanged();
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40 || bytes(metadata.symbol).length == 0
                || bytes(metadata.symbol).length > 10 || bytes(metadata.contractURI).length == 0
        ) revert InvalidMetadata();
        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, metadata.salt));
        if (usedSalts[effectiveSalt]) revert SaltAlreadyUsed();
        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value != currentLaunchFee + initialBuyAmount) revert InsufficientLaunchFee();

        usedSalts[effectiveSalt] = true;
        launchId = ++launchCount;
        token = _deployToken(metadata, effectiveSalt, MAX_SUPPLY, address(liquidityLocker));
        DirectDexLiquidityLocker.PoolConfig memory config = launchConfig;
        (positionId, poolId) = liquidityLocker.lockTokenOnlyLiquidity(launchId, token, MAX_SUPPLY, msg.sender, config);
        if (currentLaunchFee != 0) revenueRouter.depositLaunchRevenue{value: currentLaunchFee}();

        if (initialBuyAmount > 0) {
            uint256 bought = _executeInitialBuy(token, config, initialBuyAmount, minimumTokensOut);
            if (bought > MAX_INITIAL_BUY_TOKENS) revert InitialBuyExceedsFivePercent();
            if (!IERC20Minimal(token).transfer(msg.sender, bought)) revert TokenTransferFailed();
            emit CreatorInitialBuy(launchId, token, msg.sender, initialBuyAmount, bought);
        }

        emit DirectLaunchFeePaid(launchId, msg.sender, currentLaunchFee);
        emit DirectLaunchCreated(
            launchId,
            token,
            msg.sender,
            poolId,
            positionId,
            config.poolFee,
            config.tickSpacing,
            config.platformShareBps,
            config.creatorShareBps,
            metadata.name,
            metadata.symbol,
            metadata.contractURI
        );
    }

    function _executeInitialBuy(
        address token,
        DirectDexLiquidityLocker.PoolConfig memory config,
        uint256 nativeAmount,
        uint256 minimumTokensOut
    ) private returns (uint256 bought) {
        if (nativeAmount > type(uint128).max || minimumTokensOut > type(uint128).max) revert InitialBuyFailed();
        uint256 balanceBefore = IERC20Minimal(token).balanceOf(address(this));
        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: address(0),
            currency1: token,
            fee: config.poolFee,
            tickSpacing: config.tickSpacing,
            hooks: address(liquidityLocker.initializationGuard())
        });
        InitialBuyRouter.ExactInputSingleParams memory swap = InitialBuyRouter.ExactInputSingleParams({
            poolKey: pool,
            zeroForOne: true,
            amountIn: uint128(nativeAmount),
            amountOutMinimum: uint128(minimumTokensOut),
            hookData: bytes("")
        });
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(swap);
        params[1] = abi.encode(address(0), nativeAmount);
        params[2] = abi.encode(token, minimumTokensOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(bytes(hex"060c0f"), params);
        InitialBuyRouter(launchRouter).execute{value: nativeAmount}(hex"10", inputs, block.timestamp + 30 minutes);
        bought = IERC20Minimal(token).balanceOf(address(this)) - balanceBefore;
        if (bought < minimumTokensOut || bought == 0) revert InitialBuyFailed();
    }

    function setLaunchConfig(DirectDexLiquidityLocker.PoolConfig calldata newConfig) external onlyOwner {
        _setLaunchConfig(newConfig);
    }

    function launchConfigHash() public view returns (bytes32) {
        return keccak256(abi.encode(launchConfig));
    }

    function claimLaunchFees() external returns (uint256 amount) {
        amount = pendingLaunchFees;
        if (amount == 0) revert InsufficientLaunchFee();
        pendingLaunchFees = 0;
        (bool ok,) = launchFeeRecipient.call{value: amount}("");
        if (!ok) revert LaunchFeeClaimFailed();
        emit DirectLaunchFeesClaimed(launchFeeRecipient, amount);
    }

    function _setLaunchConfig(DirectDexLiquidityLocker.PoolConfig memory config) internal {
        if (
            (config.poolFee == 0 || (config.poolFee > MAX_POOL_FEE && config.poolFee != DYNAMIC_FEE_FLAG))
                || config.tickSpacing <= 0
                || config.tickLower >= config.tickUpper || config.tickLower % config.tickSpacing != 0
                || config.tickUpper % config.tickSpacing != 0 || config.initialSqrtPriceX96 == 0
                || config.platformShareBps + config.creatorShareBps != 10_000
        ) revert InvalidLaunchConfig();
        launchConfig = config;
        emit DirectLaunchConfigUpdated(
            config.poolFee,
            config.tickSpacing,
            config.tickLower,
            config.tickUpper,
            config.initialSqrtPriceX96,
            config.platformShareBps,
            config.creatorShareBps
        );
    }

    function _deployToken(
        TokenMetadata calldata metadata,
        bytes32 effectiveSalt,
        uint256 supply,
        address liquidityRecipient
    )
        internal
        virtual
        returns (address token);
}
