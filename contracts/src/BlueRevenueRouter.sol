// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {BlueStakingVault} from "./BlueStakingVault.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

interface IERC20RouterBalance {
    function balanceOf(address account) external view returns (uint256);
}

interface IWETH is IERC20RouterBalance {
    function deposit() external payable;
}

/// @notice Accepts manually bridged Base revenue, splits it, and streams the staker share through the vault.
contract BlueRevenueRouter is TwoStepAdmin, ReentrancyGuard {
    using SafeTransferLib for address;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidShare();
    error NotRevenueOperator();

    uint16 public constant BPS = 10_000;

    address public immutable rewardToken;
    BlueStakingVault public immutable vault;
    address public treasury;
    address public revenueOperator;
    uint16 public stakingShareBps;

    event RevenueDistributed(
        address indexed payer, uint256 grossRevenue, uint256 stakingRewards, uint256 treasuryRevenue
    );
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event RevenueOperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event StakingShareUpdated(uint256 previousShareBps, uint256 newShareBps);

    constructor(
        address stakingToken_,
        address rewardToken_,
        address admin_,
        address guardian_,
        address treasury_,
        address revenueOperator_,
        uint16 stakingShareBps_,
        uint64 rewardsDuration_,
        uint64 cooldownDuration_
    ) TwoStepAdmin(admin_) {
        if (
            stakingToken_ == address(0) || rewardToken_ == address(0) || guardian_ == address(0)
                || treasury_ == address(0) || revenueOperator_ == address(0) || rewardToken_.code.length == 0
        ) revert InvalidAddress();
        if (stakingShareBps_ > BPS) revert InvalidShare();
        rewardToken = rewardToken_;
        treasury = treasury_;
        revenueOperator = revenueOperator_;
        stakingShareBps = stakingShareBps_;
        vault = new BlueStakingVault(
            stakingToken_,
            rewardToken_,
            admin_,
            guardian_,
            address(this),
            rewardsDuration_,
            cooldownDuration_
        );
        rewardToken_.safeApprove(address(vault), type(uint256).max);
    }

    receive() external payable nonReentrant {
        if (msg.sender != revenueOperator) revert NotRevenueOperator();
        _wrapAndDistribute(msg.value, msg.sender);
    }

    modifier onlyRevenueOperator() {
        if (msg.sender != revenueOperator) revert NotRevenueOperator();
        _;
    }

    function distributeNative() external payable onlyRevenueOperator nonReentrant {
        _wrapAndDistribute(msg.value, msg.sender);
    }

    function distributeWeth(uint256 amount) external onlyRevenueOperator nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = IERC20RouterBalance(rewardToken).balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20RouterBalance(rewardToken).balanceOf(address(this)) - beforeBalance != amount) {
            revert InvalidAmount();
        }
        _distribute(amount, msg.sender);
    }

    /// @notice Routes WETH that was sent directly to this contract.
    function flushWeth() external onlyRevenueOperator nonReentrant returns (uint256 amount) {
        amount = IERC20RouterBalance(rewardToken).balanceOf(address(this));
        if (amount == 0) revert InvalidAmount();
        _distribute(amount, msg.sender);
    }

    /// @notice Wraps and routes native ETH forced into this contract without calling receive.
    function flushNative() external onlyRevenueOperator nonReentrant returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) revert InvalidAmount();
        _wrapAndDistribute(amount, msg.sender);
    }

    /// @notice Accounts WETH sent directly to the vault without bypassing distributor authorization.
    function syncVaultRewardSurplus() external onlyRevenueOperator nonReentrant returns (uint256 amount) {
        amount = vault.syncRewardSurplus();
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setRevenueOperator(address newOperator) external onlyAdmin {
        if (newOperator == address(0)) revert InvalidAddress();
        emit RevenueOperatorUpdated(revenueOperator, newOperator);
        revenueOperator = newOperator;
    }

    function setStakingShareBps(uint16 newShareBps) external onlyAdmin {
        if (newShareBps > BPS) revert InvalidShare();
        emit StakingShareUpdated(stakingShareBps, newShareBps);
        stakingShareBps = newShareBps;
    }

    function _wrapAndDistribute(uint256 amount, address payer) internal {
        if (amount == 0) revert InvalidAmount();
        IWETH(rewardToken).deposit{value: amount}();
        _distribute(amount, payer);
    }

    function _distribute(uint256 amount, address payer) internal {
        uint256 stakingAmount = (amount * stakingShareBps) / BPS;
        uint256 treasuryAmount = amount - stakingAmount;
        if (treasuryAmount != 0) rewardToken.safeTransfer(treasury, treasuryAmount);
        if (stakingAmount != 0) vault.fundRewards(stakingAmount);
        emit RevenueDistributed(payer, amount, stakingAmount, treasuryAmount);
    }
}
