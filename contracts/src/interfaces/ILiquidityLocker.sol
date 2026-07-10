// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface ILiquidityLocker {
    function isDexBacked() external view returns (bool);

    function lockLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        payable
        returns (bytes32 positionId);
}
