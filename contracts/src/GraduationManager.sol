// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20} from "./interfaces/IB20.sol";
import {ILiquidityLocker} from "./interfaces/ILiquidityLocker.sol";
import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {PolicyGuard} from "./PolicyGuard.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

contract GraduationManager is PolicyGuard, ReentrancyGuard {
    error NotReady();
    error AlreadyGraduated();
    error NoLiquidity();
    error LiquidityLockerNotDexBacked();

    BondingCurveMarket public immutable market;
    ILiquidityLocker public immutable liquidityLocker;

    event Graduated(uint256 indexed launchId, address indexed token, bytes32 positionId);
    event RolesRenounced(uint256 indexed launchId, address indexed token);
    event LiquidityLocked(uint256 indexed launchId, address indexed token, uint256 ethAmount, uint256 tokenAmount, bytes32 positionId);

    constructor(BondingCurveMarket market_, ILiquidityLocker liquidityLocker_, IPolicyRegistry policyRegistry_)
        PolicyGuard(policyRegistry_)
    {
        market = market_;
        liquidityLocker = liquidityLocker_;
    }

    receive() external payable {}

    function graduate(uint256 launchId) external nonReentrant returns (bytes32 positionId) {
        (
            address token,
            address creator,
            uint256 ethAmount,
            uint256 liquidityTokenAmount,
            uint256 creatorAllocation
        ) = market.graduationLiquidity(launchId);

        (,,,,,,,,,,,,,, bool graduationReady, bool graduated) = market.launches(launchId);
        if (!graduationReady) revert NotReady();
        if (graduated) revert AlreadyGraduated();
        if (ethAmount == 0 || liquidityTokenAmount == 0) revert NoLiquidity();
        if (!liquidityLocker.isDexBacked()) revert LiquidityLockerNotDexBacked();

        IB20(token).mint(address(liquidityLocker), liquidityTokenAmount);
        if (creatorAllocation > 0) {
            IB20(token).mint(creator, creatorAllocation);
        }

        uint256 withdrawn = market.withdrawGraduationEth(launchId, payable(address(this)));
        positionId = liquidityLocker.lockLiquidity{value: withdrawn}(launchId, token, liquidityTokenAmount);

        _openTransferPolicies(token);
        IB20 b20 = IB20(token);
        b20.revokeRole(b20.MINT_ROLE(), address(market));
        b20.revokeRole(b20.MINT_ROLE(), address(this));
        b20.renounceLastAdmin();
        market.markGraduated(launchId);

        emit LiquidityLocked(launchId, token, withdrawn, liquidityTokenAmount, positionId);
        emit RolesRenounced(launchId, token);
        emit Graduated(launchId, token, positionId);
    }
}
