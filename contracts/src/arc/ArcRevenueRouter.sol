// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "../access/TwoStepAdmin.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";

/// @notice Native-USDC revenue accounting for Arc.
contract ArcRevenueRouter is TwoStepAdmin, ReentrancyGuard, IRevenueRouter {
    error InvalidAddress();
    error InvalidAmount();
    error UsdcTransferFailed();

    uint16 private constant BPS = 10_000;
    IFeePolicy public immutable policy;
    address public treasury;
    address public bridgeRecipient;
    uint256 public pendingTreasuryUsdc;
    uint256 public pendingBridgeUsdc;

    event TradeRevenueDeposited(address indexed payer, uint256 grossUsdc, uint256 bridgeUsdc, uint256 treasuryUsdc);
    event LaunchRevenueDeposited(address indexed payer, uint256 grossUsdc, uint256 bridgeUsdc, uint256 treasuryUsdc);
    event TreasuryUsdcClaimed(address indexed treasury, uint256 amount);
    event BridgeUsdcReleased(address indexed recipient, uint256 amount);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event BridgeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    constructor(address admin_, IFeePolicy policy_, address treasury_, address bridgeRecipient_) TwoStepAdmin(admin_) {
        if (address(policy_) == address(0) || treasury_ == address(0) || bridgeRecipient_ == address(0)) {
            revert InvalidAddress();
        }
        policy = policy_;
        treasury = treasury_;
        bridgeRecipient = bridgeRecipient_;
    }

    receive() external payable nonReentrant {
        _depositTrade(msg.value, msg.sender);
    }

    function depositTradeRevenue() external payable nonReentrant {
        _depositTrade(msg.value, msg.sender);
    }

    function depositLaunchRevenue() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        uint256 bridgeAmount = (msg.value * policy.launchStakingShareBps()) / BPS;
        pendingBridgeUsdc += bridgeAmount;
        pendingTreasuryUsdc += msg.value - bridgeAmount;
        emit LaunchRevenueDeposited(msg.sender, msg.value, bridgeAmount, msg.value - bridgeAmount);
    }

    function claimTreasuryUsdc() external nonReentrant returns (uint256 amount) {
        amount = pendingTreasuryUsdc;
        if (amount == 0) revert InvalidAmount();
        pendingTreasuryUsdc = 0;
        (bool ok,) = payable(treasury).call{value: amount}("");
        if (!ok) revert UsdcTransferFailed();
        emit TreasuryUsdcClaimed(treasury, amount);
    }

    function releaseBridgeUsdc() external nonReentrant returns (uint256 amount) {
        amount = pendingBridgeUsdc;
        if (amount == 0) revert InvalidAmount();
        pendingBridgeUsdc = 0;
        (bool ok,) = payable(bridgeRecipient).call{value: amount}("");
        if (!ok) revert UsdcTransferFailed();
        emit BridgeUsdcReleased(bridgeRecipient, amount);
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setBridgeRecipient(address newRecipient) external onlyAdmin {
        if (newRecipient == address(0)) revert InvalidAddress();
        emit BridgeRecipientUpdated(bridgeRecipient, newRecipient);
        bridgeRecipient = newRecipient;
    }

    function _depositTrade(uint256 amount, address payer) private {
        if (amount == 0) revert InvalidAmount();
        uint256 bridgeAmount = (amount * policy.tradeStakingShareBps()) / BPS;
        pendingBridgeUsdc += bridgeAmount;
        pendingTreasuryUsdc += amount - bridgeAmount;
        emit TradeRevenueDeposited(payer, amount, bridgeAmount, amount - bridgeAmount);
    }
}
