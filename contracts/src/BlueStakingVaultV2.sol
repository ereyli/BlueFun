// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {FullMath} from "./libraries/FullMath.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

interface IERC20StakeBalance {
    function balanceOf(address account) external view returns (uint256);
}

/// @notice BLUE staking with streamed native ETH rewards and an aggregating cooldown exit.
contract BlueStakingVaultV2 is TwoStepAdmin, ReentrancyGuard {
    using SafeTransferLib for address;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDuration();
    error NotGuardian();
    error NotDistributor();
    error StakingPaused();
    error RewardsPaused();
    error EmergencyMode();
    error EmergencyModeDisabled();
    error NoCooldown();
    error CooldownNotFinished();
    error InsufficientStake();
    error InsufficientCoolingStake();
    error ProtectedAsset();
    error InsufficientSurplus();
    error UnexpectedTokenBehavior();
    error NativeTransferFailed();

    uint256 public constant PRECISION = 1e18;
    uint64 public constant MIN_REWARDS_DURATION = 1 days;
    uint64 public constant MAX_REWARDS_DURATION = 30 days;
    uint64 public constant MIN_COOLDOWN_DURATION = 1 days;
    uint64 public constant MAX_COOLDOWN_DURATION = 365 days;

    address public immutable stakingToken;
    address public guardian;
    address public distributor;
    uint64 public rewardsDuration;
    uint64 public cooldownDuration;
    bool public stakingIsPaused;
    bool public rewardsArePaused;
    bool public emergencyExitEnabled;

    uint256 public totalActiveStake;
    uint256 public totalCoolingStake;
    uint256 public rewardRate;
    uint256 public rewardPerTokenStored;
    uint256 public queuedRewards;
    uint256 public accountedRewardBalance;
    uint64 public lastUpdateTime;
    uint64 public periodFinish;

    mapping(address account => uint256 amount) public activeBalanceOf;
    mapping(address account => uint256 amount) public coolingBalanceOf;
    mapping(address account => uint64 timestamp) public cooldownEnd;
    mapping(address account => uint256 value) public userRewardPerTokenPaid;
    mapping(address account => uint256 amount) public rewards;

    event Staked(address indexed account, uint256 amount);
    event UnstakeRequested(address indexed account, uint256 addedAmount, uint256 totalPending, uint256 availableAt);
    event UnstakeCancelled(address indexed account, uint256 amount, uint256 remainingPending);
    event Withdrawn(address indexed account, address indexed recipient, uint256 amount, uint256 remainingPending);
    event RewardPaid(address indexed account, address indexed recipient, uint256 amount);
    event RewardsFunded(address indexed distributor, uint256 amount, uint256 rewardRate, uint256 periodFinish);
    event RewardsQueued(uint256 amount);
    event RewardSurplusSynced(address indexed caller, uint256 amount);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event DistributorUpdated(address indexed previousDistributor, address indexed newDistributor);
    event RewardsDurationUpdated(uint256 previousDuration, uint256 newDuration);
    event CooldownDurationUpdated(uint256 previousDuration, uint256 newDuration);
    event PauseStatesUpdated(bool stakingPaused, bool rewardsPaused, address indexed caller);
    event EmergencyExitActivated(address indexed caller);
    event SurplusStakeRecovered(address indexed recipient, uint256 amount);
    event TokenRecovered(address indexed token, address indexed recipient, uint256 amount);
    event NativeSurplusRecovered(address indexed recipient, uint256 amount);

    constructor(
        address stakingToken_,
        address admin_,
        address guardian_,
        address distributor_,
        uint64 rewardsDuration_,
        uint64 cooldownDuration_
    ) TwoStepAdmin(admin_) {
        if (
            stakingToken_ == address(0) || stakingToken_.code.length == 0 || guardian_ == address(0)
                || distributor_ == address(0)
        ) revert InvalidAddress();
        _validateRewardsDuration(rewardsDuration_);
        _validateCooldownDuration(cooldownDuration_);
        stakingToken = stakingToken_;
        guardian = guardian_;
        distributor = distributor_;
        rewardsDuration = rewardsDuration_;
        cooldownDuration = cooldownDuration_;
    }

    receive() external payable nonReentrant {
        if (msg.sender != distributor) revert NotDistributor();
        _fundRewards(msg.value);
    }

    modifier onlyGuardianOrAdmin() {
        if (msg.sender != guardian && msg.sender != admin) revert NotGuardian();
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalActiveStake == 0) return rewardPerTokenStored;
        uint256 applicable = lastTimeRewardApplicable();
        if (applicable <= lastUpdateTime) return rewardPerTokenStored;
        return rewardPerTokenStored
            + FullMath.mulDiv((applicable - lastUpdateTime) * PRECISION, rewardRate, totalActiveStake);
    }

    function earned(address account) public view returns (uint256) {
        return rewards[account]
            + FullMath.mulDiv(
                activeBalanceOf[account], rewardPerToken() - userRewardPerTokenPaid[account], PRECISION
            );
    }

    function remainingScheduledRewards() public view returns (uint256) {
        return block.timestamp < periodFinish ? (periodFinish - block.timestamp) * rewardRate : 0;
    }

    function stakeLiability() public view returns (uint256) {
        return totalActiveStake + totalCoolingStake;
    }

    function stake(uint256 amount) external nonReentrant {
        if (emergencyExitEnabled) revert EmergencyMode();
        if (stakingIsPaused) revert StakingPaused();
        if (amount == 0) revert InvalidAmount();
        _updateReward(msg.sender);
        uint256 beforeBalance = IERC20StakeBalance(stakingToken).balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20StakeBalance(stakingToken).balanceOf(address(this)) - beforeBalance != amount) {
            revert UnexpectedTokenBehavior();
        }
        activeBalanceOf[msg.sender] += amount;
        totalActiveStake += amount;
        if (totalActiveStake == amount) _startQueuedRewards();
        emit Staked(msg.sender, amount);
    }

    /// @dev Additional requests aggregate and reset the timer for the entire pending amount.
    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (activeBalanceOf[msg.sender] < amount) revert InsufficientStake();
        _updateReward(msg.sender);
        activeBalanceOf[msg.sender] -= amount;
        totalActiveStake -= amount;
        coolingBalanceOf[msg.sender] += amount;
        totalCoolingStake += amount;
        uint64 availableAt = _toUint64(block.timestamp + cooldownDuration);
        cooldownEnd[msg.sender] = availableAt;
        if (totalActiveStake == 0) _pauseRewardsUntilStakeReturns();
        emit UnstakeRequested(msg.sender, amount, coolingBalanceOf[msg.sender], availableAt);
    }

    function cancelUnstake(uint256 amount) external nonReentrant {
        if (emergencyExitEnabled) revert EmergencyMode();
        uint256 cooling = coolingBalanceOf[msg.sender];
        if (cooling == 0) revert NoCooldown();
        if (amount == 0 || amount > cooling) revert InsufficientCoolingStake();
        _updateReward(msg.sender);
        coolingBalanceOf[msg.sender] = cooling - amount;
        totalCoolingStake -= amount;
        activeBalanceOf[msg.sender] += amount;
        totalActiveStake += amount;
        if (cooling == amount) cooldownEnd[msg.sender] = 0;
        if (totalActiveStake == amount) _startQueuedRewards();
        emit UnstakeCancelled(msg.sender, amount, coolingBalanceOf[msg.sender]);
    }

    function withdraw(address recipient, uint256 amount) external nonReentrant returns (uint256) {
        if (recipient == address(0)) revert InvalidAddress();
        uint256 cooling = coolingBalanceOf[msg.sender];
        if (cooling == 0) revert NoCooldown();
        if (amount == 0 || amount > cooling) revert InsufficientCoolingStake();
        if (!emergencyExitEnabled && block.timestamp < cooldownEnd[msg.sender]) revert CooldownNotFinished();
        coolingBalanceOf[msg.sender] = cooling - amount;
        totalCoolingStake -= amount;
        if (cooling == amount) cooldownEnd[msg.sender] = 0;
        stakingToken.safeTransfer(recipient, amount);
        emit Withdrawn(msg.sender, recipient, amount, coolingBalanceOf[msg.sender]);
        return amount;
    }

    function emergencyWithdraw(address recipient) external nonReentrant returns (uint256 amount) {
        if (!emergencyExitEnabled) revert EmergencyModeDisabled();
        if (recipient == address(0)) revert InvalidAddress();
        _updateReward(msg.sender);
        uint256 active = activeBalanceOf[msg.sender];
        uint256 cooling = coolingBalanceOf[msg.sender];
        amount = active + cooling;
        if (amount == 0) revert InsufficientStake();
        activeBalanceOf[msg.sender] = 0;
        coolingBalanceOf[msg.sender] = 0;
        cooldownEnd[msg.sender] = 0;
        totalActiveStake -= active;
        totalCoolingStake -= cooling;
        if (totalActiveStake == 0) _pauseRewardsUntilStakeReturns();
        stakingToken.safeTransfer(recipient, amount);
        emit Withdrawn(msg.sender, recipient, amount, 0);
    }

    function claimReward(address payable recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        _updateReward(msg.sender);
        amount = rewards[msg.sender];
        if (amount == 0) revert InvalidAmount();
        rewards[msg.sender] = 0;
        accountedRewardBalance -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit RewardPaid(msg.sender, recipient, amount);
    }

    function fundRewards() external payable nonReentrant {
        if (msg.sender != distributor) revert NotDistributor();
        _fundRewards(msg.value);
    }

    function syncNativeSurplus() external nonReentrant returns (uint256 amount) {
        if (msg.sender != distributor) revert NotDistributor();
        if (address(this).balance <= accountedRewardBalance) revert InsufficientSurplus();
        amount = address(this).balance - accountedRewardBalance;
        _fundRewards(amount);
        emit RewardSurplusSynced(msg.sender, amount);
    }

    function setGuardian(address newGuardian) external onlyAdmin {
        if (newGuardian == address(0)) revert InvalidAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setDistributor(address newDistributor) external onlyAdmin {
        if (newDistributor == address(0)) revert InvalidAddress();
        emit DistributorUpdated(distributor, newDistributor);
        distributor = newDistributor;
    }

    function setRewardsDuration(uint64 newDuration) external onlyAdmin {
        _validateRewardsDuration(newDuration);
        emit RewardsDurationUpdated(rewardsDuration, newDuration);
        rewardsDuration = newDuration;
    }

    function setCooldownDuration(uint64 newDuration) external onlyAdmin {
        _validateCooldownDuration(newDuration);
        emit CooldownDurationUpdated(cooldownDuration, newDuration);
        cooldownDuration = newDuration;
    }

    function pause() external onlyGuardianOrAdmin {
        stakingIsPaused = true;
        rewardsArePaused = true;
        emit PauseStatesUpdated(true, true, msg.sender);
    }

    function setPauseStates(bool stakingPaused_, bool rewardsPaused_) external onlyAdmin {
        if (emergencyExitEnabled && (!stakingPaused_ || !rewardsPaused_)) revert EmergencyMode();
        stakingIsPaused = stakingPaused_;
        rewardsArePaused = rewardsPaused_;
        emit PauseStatesUpdated(stakingPaused_, rewardsPaused_, msg.sender);
    }

    function enableEmergencyExit() external onlyGuardianOrAdmin {
        if (emergencyExitEnabled) revert EmergencyMode();
        _updateGlobal();
        emergencyExitEnabled = true;
        stakingIsPaused = true;
        rewardsArePaused = true;
        emit PauseStatesUpdated(true, true, msg.sender);
        emit EmergencyExitActivated(msg.sender);
    }

    function recoverSurplusStakingToken(address recipient, uint256 amount) external onlyAdmin nonReentrant {
        if (recipient == address(0) || amount == 0) revert InvalidAmount();
        uint256 balance = IERC20StakeBalance(stakingToken).balanceOf(address(this));
        uint256 liability = stakeLiability();
        if (balance < liability || amount > balance - liability) revert InsufficientSurplus();
        stakingToken.safeTransfer(recipient, amount);
        emit SurplusStakeRecovered(recipient, amount);
    }

    function recoverToken(address token, address recipient, uint256 amount) external onlyAdmin nonReentrant {
        if (token == stakingToken) revert ProtectedAsset();
        if (token == address(0) || recipient == address(0) || amount == 0) revert InvalidAmount();
        token.safeTransfer(recipient, amount);
        emit TokenRecovered(token, recipient, amount);
    }

    function recoverNativeSurplus(address payable recipient, uint256 amount) external onlyAdmin nonReentrant {
        if (recipient == address(0) || amount == 0 || address(this).balance < accountedRewardBalance) {
            revert InvalidAmount();
        }
        if (amount > address(this).balance - accountedRewardBalance) revert InsufficientSurplus();
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit NativeSurplusRecovered(recipient, amount);
    }

    function _fundRewards(uint256 amount) internal {
        if (emergencyExitEnabled) revert EmergencyMode();
        if (rewardsArePaused) revert RewardsPaused();
        if (amount == 0) revert InvalidAmount();
        _updateGlobal();
        accountedRewardBalance += amount;
        _addRewards(amount);
        emit RewardsFunded(msg.sender, amount, rewardRate, periodFinish);
    }

    function _updateGlobal() internal {
        uint256 applicable = lastTimeRewardApplicable();
        if (applicable <= lastUpdateTime) return;
        if (totalActiveStake != 0) {
            rewardPerTokenStored +=
                FullMath.mulDiv((applicable - lastUpdateTime) * PRECISION, rewardRate, totalActiveStake);
        }
        lastUpdateTime = _toUint64(applicable);
    }

    function _updateReward(address account) internal {
        _updateGlobal();
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }

    function _addRewards(uint256 amount) internal {
        uint256 leftover = remainingScheduledRewards();
        rewardRate = 0;
        periodFinish = _toUint64(block.timestamp);
        lastUpdateTime = _toUint64(block.timestamp);
        uint256 available = amount + leftover + queuedRewards;
        queuedRewards = 0;
        if (totalActiveStake == 0) {
            queuedRewards = available;
            emit RewardsQueued(available);
        } else {
            _scheduleRewards(available);
        }
    }

    function _scheduleRewards(uint256 available) internal {
        uint256 rate = available / rewardsDuration;
        if (rate == 0) {
            queuedRewards = available;
            emit RewardsQueued(available);
            return;
        }
        rewardRate = rate;
        queuedRewards = available - (rate * rewardsDuration);
        lastUpdateTime = _toUint64(block.timestamp);
        periodFinish = _toUint64(block.timestamp + rewardsDuration);
    }

    function _pauseRewardsUntilStakeReturns() internal {
        uint256 remaining = remainingScheduledRewards();
        if (remaining != 0) queuedRewards += remaining;
        rewardRate = 0;
        lastUpdateTime = _toUint64(block.timestamp);
        periodFinish = _toUint64(block.timestamp);
        if (remaining != 0) emit RewardsQueued(remaining);
    }

    function _startQueuedRewards() internal {
        uint256 amount = queuedRewards;
        if (amount == 0 || rewardsArePaused || emergencyExitEnabled) return;
        queuedRewards = 0;
        _scheduleRewards(amount);
    }

    function _validateRewardsDuration(uint64 duration) internal pure {
        if (duration < MIN_REWARDS_DURATION || duration > MAX_REWARDS_DURATION) revert InvalidDuration();
    }

    function _validateCooldownDuration(uint64 duration) internal pure {
        if (duration < MIN_COOLDOWN_DURATION || duration > MAX_COOLDOWN_DURATION) revert InvalidDuration();
    }

    function _toUint64(uint256 value) internal pure returns (uint64 converted) {
        if (value > type(uint64).max) revert InvalidDuration();
        converted = uint64(value);
    }
}
