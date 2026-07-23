// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "../access/TwoStepAdmin.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";

/// @notice Stable-specific policy for Direct-only launches. Native-denominated values use 18-decimal USDT0.
/// @dev The canonical Uniswap v3 pool fee is fixed at 1%; its 70/30 distribution is immutable in the locker.
contract StableFeePolicy is TwoStepAdmin, IFeePolicy {
    error InvalidAddress();
    error InvalidFee();
    error NotGuardian();

    uint16 public constant buyPlatformFeeBps = 70;
    uint16 public constant buyCreatorFeeBps = 30;
    uint16 public constant sellPlatformFeeBps = 70;
    uint16 public constant sellBurnFeeBps = 30;
    uint16 public constant tradeStakingShareBps = 0;
    uint16 public constant launchStakingShareBps = 0;
    uint256 public constant MAX_LAUNCH_FEE = 10 ether;

    address public guardian;
    uint256 public launchFee;
    bool public newLaunchesPaused;

    event LaunchFeeUpdated(uint256 launchFee, uint16 stakingShareBps);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event NewLaunchPauseUpdated(bool paused, address indexed caller);

    constructor(address admin_, address guardian_, uint256 initialLaunchFee) TwoStepAdmin(admin_) {
        if (guardian_ == address(0)) revert InvalidAddress();
        if (initialLaunchFee > MAX_LAUNCH_FEE) revert InvalidFee();
        guardian = guardian_;
        launchFee = initialLaunchFee;
    }

    function setLaunchFee(uint256 newLaunchFee, uint16 stakingShareBps) external onlyAdmin {
        if (newLaunchFee > MAX_LAUNCH_FEE || stakingShareBps != 0) revert InvalidFee();
        launchFee = newLaunchFee;
        emit LaunchFeeUpdated(newLaunchFee, 0);
    }

    function setTradeFees(uint16 buyPlatform, uint16 buyCreator, uint16 sellPlatform, uint16 sellBurn)
        external
        pure
    {
        if (buyPlatform != 70 || buyCreator != 30 || sellPlatform != 70 || sellBurn != 30) revert InvalidFee();
    }

    function setTradeStakingShare(uint16 stakingShareBps) external pure {
        if (stakingShareBps != 0) revert InvalidFee();
    }

    function setGuardian(address newGuardian) external onlyAdmin {
        if (newGuardian == address(0)) revert InvalidAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function pauseNewLaunches() external {
        if (msg.sender != guardian && msg.sender != admin) revert NotGuardian();
        newLaunchesPaused = true;
        emit NewLaunchPauseUpdated(true, msg.sender);
    }

    function unpauseNewLaunches() external onlyAdmin {
        newLaunchesPaused = false;
        emit NewLaunchPauseUpdated(false, msg.sender);
    }
}
