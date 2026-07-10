// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ILiquidityLocker} from "./interfaces/ILiquidityLocker.sol";
import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

contract Erc20GraduationManager is ReentrancyGuard {
    error NotReady();
    error AlreadyGraduated();
    error NoLiquidity();
    error LiquidityLockerNotDexBacked();

    BondingCurveMarket public immutable market;
    ILiquidityLocker public immutable liquidityLocker;

    event Graduated(uint256 indexed launchId, address indexed token, bytes32 positionId);
    event LiquidityLocked(
        uint256 indexed launchId, address indexed token, uint256 ethAmount, uint256 tokenAmount, bytes32 positionId
    );

    constructor(BondingCurveMarket market_, ILiquidityLocker liquidityLocker_) {
        market = market_;
        liquidityLocker = liquidityLocker_;
    }

    receive() external payable {}

    function graduate(uint256 launchId) external nonReentrant returns (bytes32 positionId) {
        (address token, address creator, uint256 ethAmount, uint256 liquidityTokenAmount,) =
            market.graduationLiquidity(launchId);
        (,,,,,,,,,,,,,,, bool graduationReady, bool graduated) = market.launches(launchId);
        if (!graduationReady) revert NotReady();
        if (graduated) revert AlreadyGraduated();
        if (ethAmount == 0 || liquidityTokenAmount == 0) revert NoLiquidity();
        if (!liquidityLocker.isDexBacked()) revert LiquidityLockerNotDexBacked();
        market.withdrawGraduationTokens(launchId, address(liquidityLocker), liquidityTokenAmount);
        uint256 withdrawn = market.withdrawGraduationEth(launchId, payable(address(this)));
        positionId = liquidityLocker.lockLiquidity{value: withdrawn}(launchId, token, liquidityTokenAmount, creator);
        market.markGraduated(launchId);
        emit LiquidityLocked(launchId, token, withdrawn, liquidityTokenAmount, positionId);
        emit Graduated(launchId, token, positionId);
    }
}
