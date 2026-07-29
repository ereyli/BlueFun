// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20Minimal} from "../UniswapV4LiquidityLocker.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IArcDirectDexAdapter} from "./IArcDexAdapter.sol";
import {ArcV3LiquidityLocker} from "./ArcV3LiquidityLocker.sol";
import {
    IArcNativeUSDC,
    IArcV3Factory,
    IArcV3PositionManager,
    IArcV3SwapRouter
} from "./ArcV3Interfaces.sol";
import {IStableSwapRouter02} from "../stable/StableUniswapV3Interfaces.sol";

/// @notice Frozen Arc Direct integration for the live Uniswap v3-compatible AMM.
/// @dev Arc exposes the same USDC balance as 18-decimal native value and through
///      a 6-decimal ERC-20 predeploy. Every payable amount must therefore be an
///      exact multiple of 1e12 before it is approved to the v3 router.
contract ArcV3DirectAdapter is IArcDirectDexAdapter, ReentrancyGuard {
    error NotDirectFactory();
    error InvalidAddress();
    error InvalidInfrastructure();
    error InvalidConfigHash();
    error InvalidUSDCPrecision();
    error TokenTransferFailed();
    error TokenApprovalFailed();
    error InitialBuyFailed();
    error UnexpectedNativeBalance();

    uint256 public constant ARC_CHAIN_ID = 5_042;
    uint256 public constant NATIVE_TO_ERC20_SCALE = 1e12;
    uint24 public constant POOL_FEE = 10_000;
    int24 public constant TICK_SPACING = 200;

    address public immutable directFactory;
    IArcNativeUSDC public immutable usdc;
    IArcV3Factory public immutable uniswapFactory;
    IArcV3PositionManager public immutable positionManager;
    IArcV3SwapRouter public immutable swapRouter;
    ArcV3LiquidityLocker public immutable liquidityLocker;
    bytes32 public immutable configHash;
    bytes32 public immutable factoryCodeHash;
    bytes32 public immutable positionManagerCodeHash;
    bytes32 public immutable swapRouterCodeHash;
    bytes32 public immutable usdcCodeHash;

    event ArcV3DirectLiquidityCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address pool,
        uint256 positionTokenId,
        uint256 tokenAmount
    );
    event ArcV3CreatorInitialBuy(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 nativeUsdcIn,
        uint256 erc20UsdcIn,
        uint256 tokenAmountOut
    );

    constructor(
        address directFactory_,
        IArcNativeUSDC usdc_,
        IArcV3Factory uniswapFactory_,
        IArcV3PositionManager positionManager_,
        IArcV3SwapRouter swapRouter_,
        ArcV3LiquidityLocker liquidityLocker_
    ) {
        if (
            directFactory_ == address(0) || address(usdc_) == address(0)
                || address(uniswapFactory_) == address(0) || address(positionManager_) == address(0)
                || address(swapRouter_) == address(0) || address(liquidityLocker_) == address(0)
        ) revert InvalidAddress();
        if (
            directFactory_.code.length == 0 || address(usdc_).code.length == 0
                || address(uniswapFactory_).code.length == 0 || address(positionManager_).code.length == 0
                || address(swapRouter_).code.length == 0 || address(liquidityLocker_).code.length == 0
        ) revert InvalidInfrastructure();
        if (
            usdc_.decimals() != 6 || uniswapFactory_.feeAmountTickSpacing(POOL_FEE) != TICK_SPACING
                || positionManager_.factory() != address(uniswapFactory_)
                || swapRouter_.factory() != address(uniswapFactory_)
        ) revert InvalidInfrastructure();

        directFactory = directFactory_;
        usdc = usdc_;
        uniswapFactory = uniswapFactory_;
        positionManager = positionManager_;
        swapRouter = swapRouter_;
        liquidityLocker = liquidityLocker_;
        factoryCodeHash = address(uniswapFactory_).codehash;
        positionManagerCodeHash = address(positionManager_).codehash;
        swapRouterCodeHash = address(swapRouter_).codehash;
        usdcCodeHash = address(usdc_).codehash;
        configHash = keccak256(
            abi.encode(
                "BLUEFUN_ARC_V3_DIRECT_V1",
                ARC_CHAIN_ID,
                directFactory_,
                address(usdc_),
                address(uniswapFactory_),
                address(positionManager_),
                address(swapRouter_),
                address(liquidityLocker_),
                liquidityLocker_.configHash(),
                POOL_FEE,
                TICK_SPACING,
                address(uniswapFactory_).codehash,
                address(positionManager_).codehash,
                address(swapRouter_).codehash,
                address(usdc_).codehash
            )
        );
    }

    function isReady() external view returns (bool) {
        return block.chainid == ARC_CHAIN_ID && directFactory.code.length != 0
            && address(uniswapFactory).codehash == factoryCodeHash
            && address(positionManager).codehash == positionManagerCodeHash
            && address(swapRouter).codehash == swapRouterCodeHash && address(usdc).codehash == usdcCodeHash
            && liquidityLocker.factory() == address(this)
            && uniswapFactory.feeAmountTickSpacing(POOL_FEE) == TICK_SPACING
            && positionManager.factory() == address(uniswapFactory) && swapRouter.factory() == address(uniswapFactory);
    }

    function createDirectLaunch(
        uint256 launchId,
        address token,
        uint256 tokenAmount,
        address creator,
        bytes32 approvedConfigHash,
        uint256 minimumTokensOut
    )
        external
        payable
        nonReentrant
        returns (bytes32 poolId, bytes32 positionId, uint256 creatorTokensOut)
    {
        if (msg.sender != directFactory) revert NotDirectFactory();
        if (token == address(0) || creator == address(0) || tokenAmount == 0) revert InvalidAddress();
        if (approvedConfigHash != configHash) revert InvalidConfigHash();
        if (msg.value % NATIVE_TO_ERC20_SCALE != 0) revert InvalidUSDCPrecision();
        if (IERC20Minimal(token).balanceOf(address(this)) != tokenAmount) revert TokenTransferFailed();
        if (!IERC20Minimal(token).transfer(address(liquidityLocker), tokenAmount)) revert TokenTransferFailed();

        address pool;
        (positionId, poolId, pool) =
            liquidityLocker.lockTokenOnlyLiquidity(launchId, token, tokenAmount, creator);
        emit ArcV3DirectLiquidityCreated(
            launchId, token, creator, pool, uint256(positionId), tokenAmount
        );

        if (msg.value == 0) {
            if (minimumTokensOut != 0) revert InitialBuyFailed();
            return (poolId, positionId, 0);
        }

        uint256 erc20Amount = msg.value / NATIVE_TO_ERC20_SCALE;
        if (erc20Amount == 0 || usdc.balanceOf(address(this)) < erc20Amount) revert InitialBuyFailed();
        if (!usdc.approve(address(swapRouter), erc20Amount)) revert TokenApprovalFailed();
        creatorTokensOut = swapRouter.exactInputSingle(
            IStableSwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: token,
                fee: POOL_FEE,
                recipient: creator,
                amountIn: erc20Amount,
                amountOutMinimum: minimumTokensOut,
                sqrtPriceLimitX96: 0
            })
        );
        if (!usdc.approve(address(swapRouter), 0)) revert TokenApprovalFailed();
        if (creatorTokensOut == 0 || creatorTokensOut < minimumTokensOut) revert InitialBuyFailed();
        if (address(this).balance != 0 || usdc.balanceOf(address(this)) != 0) revert UnexpectedNativeBalance();
        emit ArcV3CreatorInitialBuy(
            launchId, token, creator, msg.value, erc20Amount, creatorTokensOut
        );
    }
}
