// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {IFeePolicy} from "./interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "./interfaces/IRevenueRouter.sol";

/// @notice Native revenue router for Robinhood: treasury plus manually bridged Base staking reserve.
contract RemoteRevenueRouter is TwoStepAdmin, ReentrancyGuard, IRevenueRouter {
    error InvalidAddress();
    error InvalidAmount();
    error NativeTransferFailed();

    uint16 private constant BPS = 10_000;
    IFeePolicy public immutable policy;
    address public treasury;
    address public bridgeRecipient;
    uint256 public pendingTreasuryRevenue;
    uint256 public pendingBridgeReserve;

    event TradeRevenueDeposited(address indexed payer, uint256 gross, uint256 bridgeReserve, uint256 treasury);
    event LaunchRevenueDeposited(address indexed payer, uint256 amount);
    event TreasuryRevenueClaimed(address indexed treasury, uint256 amount);
    event BridgeReserveReleased(address indexed recipient, uint256 amount);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event BridgeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    constructor(address admin_, IFeePolicy policy_, address treasury_, address bridgeRecipient_)
        TwoStepAdmin(admin_)
    {
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
        uint256 reserve = (msg.value * policy.launchStakingShareBps()) / BPS;
        pendingBridgeReserve += reserve;
        pendingTreasuryRevenue += msg.value - reserve;
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

    /// @notice Permissionless release is safe because funds can only reach the configured recipient.
    function releaseBridgeReserve() external nonReentrant returns (uint256 amount) {
        amount = pendingBridgeReserve;
        if (amount == 0) revert InvalidAmount();
        pendingBridgeReserve = 0;
        (bool ok,) = payable(bridgeRecipient).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit BridgeReserveReleased(bridgeRecipient, amount);
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
        uint256 reserve = (amount * policy.tradeStakingShareBps()) / BPS;
        pendingBridgeReserve += reserve;
        pendingTreasuryRevenue += amount - reserve;
        emit TradeRevenueDeposited(payer, amount, reserve, amount - reserve);
    }
}
