// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {IFeePolicy} from "./interfaces/IFeePolicy.sol";

/// @notice Shared, bounded fee policy for every vNext launch on one chain.
/// @dev Set `admin` to a StakingTimelock contract to enforce delayed, rotatable governance.
contract FeePolicy is TwoStepAdmin, IFeePolicy {
    error InvalidAddress();
    error InvalidFee();
    error NotGuardian();

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_SIDE_FEE_BPS = 200; // 2%
    uint256 public constant MAX_LAUNCH_FEE = 0.01 ether;

    address public guardian;
    uint16 public buyPlatformFeeBps;
    uint16 public buyCreatorFeeBps;
    uint16 public sellPlatformFeeBps;
    uint16 public sellBurnFeeBps;
    uint16 public tradeStakingShareBps;
    uint16 public launchStakingShareBps;
    uint256 public launchFee;
    bool public newLaunchesPaused;

    event TradeFeesUpdated(uint16 buyPlatform, uint16 buyCreator, uint16 sellPlatform, uint16 sellBurn);
    event TradeStakingShareUpdated(uint16 previousShareBps, uint16 newShareBps);
    event LaunchFeeUpdated(uint256 launchFee, uint16 stakingShareBps);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event NewLaunchPauseUpdated(bool paused, address indexed caller);

    constructor(address admin_, address guardian_) TwoStepAdmin(admin_) {
        if (guardian_ == address(0)) revert InvalidAddress();
        guardian = guardian_;
        buyPlatformFeeBps = 70;
        buyCreatorFeeBps = 30;
        sellPlatformFeeBps = 70;
        sellBurnFeeBps = 30;
        tradeStakingShareBps = 5_000;
        launchFee = 0.001 ether;
    }

    function setTradeFees(uint16 buyPlatform, uint16 buyCreator, uint16 sellPlatform, uint16 sellBurn)
        external
        onlyAdmin
    {
        if (buyPlatform + buyCreator > MAX_SIDE_FEE_BPS || sellPlatform + sellBurn > MAX_SIDE_FEE_BPS) {
            revert InvalidFee();
        }
        buyPlatformFeeBps = buyPlatform;
        buyCreatorFeeBps = buyCreator;
        sellPlatformFeeBps = sellPlatform;
        sellBurnFeeBps = sellBurn;
        emit TradeFeesUpdated(buyPlatform, buyCreator, sellPlatform, sellBurn);
    }

    function setLaunchFee(uint256 newLaunchFee, uint16 stakingShareBps) external onlyAdmin {
        if (newLaunchFee > MAX_LAUNCH_FEE || stakingShareBps > BPS) revert InvalidFee();
        launchFee = newLaunchFee;
        launchStakingShareBps = stakingShareBps;
        emit LaunchFeeUpdated(newLaunchFee, stakingShareBps);
    }

    function setTradeStakingShare(uint16 stakingShareBps) external onlyAdmin {
        if (stakingShareBps > BPS) revert InvalidFee();
        uint16 previousShareBps = tradeStakingShareBps;
        tradeStakingShareBps = stakingShareBps;
        emit TradeStakingShareUpdated(previousShareBps, stakingShareBps);
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
