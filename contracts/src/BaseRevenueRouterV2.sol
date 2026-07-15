// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {IFeePolicy} from "./interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "./interfaces/IRevenueRouter.sol";
import {BlueStakingVaultV2} from "./BlueStakingVaultV2.sol";

/// @notice Non-blocking native revenue router for Base.
/// @dev Treasury uses pull payments; failed/paused vault funding remains queued instead of blocking swaps.
contract BaseRevenueRouterV2 is TwoStepAdmin, ReentrancyGuard, IRevenueRouter {
    error InvalidAddress();
    error InvalidAmount();
    error NativeTransferFailed();

    uint16 private constant BPS = 10_000;
    IFeePolicy public immutable policy;
    BlueStakingVaultV2 public immutable vault;
    address public treasury;
    uint256 public pendingTreasuryRevenue;
    uint256 public pendingStakerRevenue;

    event TradeRevenueDeposited(address indexed payer, uint256 gross, uint256 stakers, uint256 treasury);
    event LaunchRevenueDeposited(address indexed payer, uint256 gross, uint256 stakers, uint256 treasury);
    event BridgedRevenueDeposited(address indexed payer, uint256 amount);
    event StakerRevenueFunded(uint256 amount);
    event TreasuryRevenueClaimed(address indexed treasury, uint256 amount);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    constructor(
        address stakingToken_,
        address admin_,
        address guardian_,
        IFeePolicy policy_,
        address treasury_,
        uint64 rewardsDuration_,
        uint64 cooldownDuration_
    ) TwoStepAdmin(admin_) {
        if (address(policy_) == address(0) || treasury_ == address(0)) {
            revert InvalidAddress();
        }
        policy = policy_;
        vault = new BlueStakingVaultV2(
            stakingToken_, admin_, guardian_, address(this), rewardsDuration_, cooldownDuration_
        );
        treasury = treasury_;
    }

    receive() external payable nonReentrant {
        _depositTrade(msg.value, msg.sender);
    }

    function depositTradeRevenue() external payable nonReentrant {
        _depositTrade(msg.value, msg.sender);
    }

    function stakingShareBps() external view returns (uint16) {
        return policy.tradeStakingShareBps();
    }

    function depositLaunchRevenue() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        uint256 stakers = (msg.value * policy.launchStakingShareBps()) / BPS;
        pendingStakerRevenue += stakers;
        pendingTreasuryRevenue += msg.value - stakers;
        emit LaunchRevenueDeposited(msg.sender, msg.value, stakers, msg.value - stakers);
        _tryFundStakers();
    }

    /// @notice Bridged remote-chain staking revenue is not split a second time.
    function depositBridgedStakerRevenue() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        pendingStakerRevenue += msg.value;
        emit BridgedRevenueDeposited(msg.sender, msg.value);
        _tryFundStakers();
    }

    function flushStakerRevenue() external nonReentrant returns (uint256 funded) {
        funded = _tryFundStakers();
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
        uint256 stakers = (amount * policy.tradeStakingShareBps()) / BPS;
        pendingStakerRevenue += stakers;
        pendingTreasuryRevenue += amount - stakers;
        emit TradeRevenueDeposited(payer, amount, stakers, amount - stakers);
        _tryFundStakers();
    }

    function _tryFundStakers() private returns (uint256 amount) {
        amount = pendingStakerRevenue;
        if (amount == 0) return 0;
        pendingStakerRevenue = 0;
        try vault.fundRewards{value: amount}() {
            emit StakerRevenueFunded(amount);
        } catch {
            pendingStakerRevenue = amount;
            amount = 0;
        }
    }
}
