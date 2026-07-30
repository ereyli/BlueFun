// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IArcNativeUSDC, IArcV3Factory, IArcV3SwapRouter} from "./ArcV3Interfaces.sol";
import {IStableSwapRouter02} from "../stable/StableUniswapV3Interfaces.sol";

/// @notice Approval-free buy router for Arc's dual-interface native USDC.
/// @dev Arc exposes one USDC balance as 18-decimal native value and through a
///      6-decimal ERC-20 interface. Buyers send native USDC with `msg.value`;
///      this contract grants the exact temporary ERC-20 allowance required by
///      Uniswap v3 and clears it before returning.
contract ArcV3NativeSwapRouter is ReentrancyGuard {
    error InvalidAddress();
    error InvalidInfrastructure();
    error InvalidUSDCPrecision();
    error InvalidPoolFee();
    error DeadlineExpired();
    error TokenApprovalFailed();
    error SwapFailed();
    error BalanceInvariantFailed();

    uint256 public constant ARC_CHAIN_ID = 5_042;
    uint256 public constant NATIVE_TO_ERC20_SCALE = 1e12;
    uint24 public constant BLUEFUN_POOL_FEE = 10_000;

    IArcNativeUSDC public immutable usdc;
    IArcV3Factory public immutable uniswapFactory;
    IArcV3SwapRouter public immutable swapRouter;

    event NativeUsdcSwap(
        address indexed buyer,
        address indexed recipient,
        address indexed tokenOut,
        uint256 nativeUsdcIn,
        uint256 erc20UsdcIn,
        uint256 tokenAmountOut
    );

    constructor(IArcNativeUSDC usdc_, IArcV3Factory uniswapFactory_, IArcV3SwapRouter swapRouter_) {
        if (
            address(usdc_) == address(0) || address(uniswapFactory_) == address(0)
                || address(swapRouter_) == address(0)
        ) revert InvalidAddress();
        if (
            address(usdc_).code.length == 0 || address(uniswapFactory_).code.length == 0
                || address(swapRouter_).code.length == 0 || usdc_.decimals() != 6
                || uniswapFactory_.feeAmountTickSpacing(BLUEFUN_POOL_FEE) != 200
                || swapRouter_.factory() != address(uniswapFactory_)
        ) revert InvalidInfrastructure();

        usdc = usdc_;
        uniswapFactory = uniswapFactory_;
        swapRouter = swapRouter_;
    }

    function isReady() external view returns (bool) {
        return block.chainid == ARC_CHAIN_ID && address(usdc).code.length != 0
            && address(uniswapFactory).code.length != 0 && address(swapRouter).code.length != 0
            && usdc.decimals() == 6 && uniswapFactory.feeAmountTickSpacing(BLUEFUN_POOL_FEE) == 200
            && swapRouter.factory() == address(uniswapFactory);
    }

    function swapExactNativeUsdcForToken(
        address tokenOut,
        uint24 fee,
        address recipient,
        uint256 amountOutMinimum,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 tokenAmountOut) {
        if (tokenOut == address(0) || tokenOut == address(usdc) || recipient == address(0)) {
            revert InvalidAddress();
        }
        if (fee != BLUEFUN_POOL_FEE) revert InvalidPoolFee();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (msg.value == 0 || msg.value % NATIVE_TO_ERC20_SCALE != 0) revert InvalidUSDCPrecision();

        uint256 erc20Amount = msg.value / NATIVE_TO_ERC20_SCALE;
        uint256 nativeBalanceBefore = address(this).balance - msg.value;
        uint256 erc20Balance = usdc.balanceOf(address(this));
        if (erc20Balance < erc20Amount) revert BalanceInvariantFailed();
        uint256 erc20BalanceBefore = erc20Balance - erc20Amount;

        if (!usdc.approve(address(swapRouter), erc20Amount)) revert TokenApprovalFailed();
        tokenAmountOut = swapRouter.exactInputSingle(
            IStableSwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: tokenOut,
                fee: fee,
                recipient: recipient,
                amountIn: erc20Amount,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );
        if (!usdc.approve(address(swapRouter), 0)) revert TokenApprovalFailed();
        if (tokenAmountOut == 0 || tokenAmountOut < amountOutMinimum) revert SwapFailed();
        if (
            address(this).balance != nativeBalanceBefore
                || usdc.balanceOf(address(this)) != erc20BalanceBefore
        ) revert BalanceInvariantFailed();

        emit NativeUsdcSwap(
            msg.sender,
            recipient,
            tokenOut,
            msg.value,
            erc20Amount,
            tokenAmountOut
        );
    }
}
