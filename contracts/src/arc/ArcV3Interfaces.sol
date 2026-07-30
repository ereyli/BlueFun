// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    IStableNonfungiblePositionManager,
    IStableSwapRouter02,
    IStableUniswapV3Factory,
    IStableUniswapV3Pool
} from "../stable/StableUniswapV3Interfaces.sol";

interface IArcNativeUSDC {
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function transfer(address recipient, uint256 amount) external returns (bool);
}
interface IArcV3Factory is IStableUniswapV3Factory {
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

interface IArcV3PositionManager is IStableNonfungiblePositionManager {
    function factory() external view returns (address);
}

interface IArcV3SwapRouter is IStableSwapRouter02 {
    function factory() external view returns (address);
}
