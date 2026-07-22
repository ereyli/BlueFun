// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "../access/TwoStepAdmin.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";

/// @notice Pull-based native MON revenue router. All platform revenue belongs to the Safe treasury.
contract MonadRevenueRouter is TwoStepAdmin, ReentrancyGuard, IRevenueRouter {
    error InvalidAddress();
    error InvalidAmount();
    error NativeTransferFailed();

    address public treasury;
    uint256 public pendingTreasuryRevenue;

    event TradeRevenueDeposited(address indexed payer, uint256 amount);
    event LaunchRevenueDeposited(address indexed payer, uint256 amount);
    event TreasuryRevenueClaimed(address indexed treasury, uint256 amount);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    constructor(address admin_, address treasury_) TwoStepAdmin(admin_) {
        if (treasury_ == address(0)) revert InvalidAddress();
        treasury = treasury_;
    }

    receive() external payable nonReentrant {
        _depositTrade(msg.value, msg.sender);
    }

    function depositTradeRevenue() external payable nonReentrant {
        _depositTrade(msg.value, msg.sender);
    }

    function depositLaunchRevenue() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        pendingTreasuryRevenue += msg.value;
        emit LaunchRevenueDeposited(msg.sender, msg.value);
    }

    function claimTreasuryRevenue() external nonReentrant returns (uint256 amount) {
        amount = pendingTreasuryRevenue;
        if (amount == 0) revert InvalidAmount();
        pendingTreasuryRevenue = 0;
        (bool ok,) = payable(treasury).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit TreasuryRevenueClaimed(treasury, amount);
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function _depositTrade(uint256 amount, address payer) private {
        if (amount == 0) revert InvalidAmount();
        pendingTreasuryRevenue += amount;
        emit TradeRevenueDeposited(payer, amount);
    }
}
