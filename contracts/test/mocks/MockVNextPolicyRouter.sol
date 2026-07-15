// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";

contract MockVNextPolicyRouter is IFeePolicy, IRevenueRouter {
    uint16 public buyPlatformFeeBps = 70;
    uint16 public buyCreatorFeeBps = 30;
    uint16 public sellPlatformFeeBps = 70;
    uint16 public sellBurnFeeBps = 30;
    uint16 public tradeStakingShareBps = 5_000;
    uint16 public launchStakingShareBps;
    uint256 public launchFee = 0.001 ether;
    bool public newLaunchesPaused;
    uint256 public tradeRevenue;
    uint256 public launchRevenue;

    receive() external payable {
        tradeRevenue += msg.value;
    }

    function depositTradeRevenue() external payable {
        tradeRevenue += msg.value;
    }

    function depositLaunchRevenue() external payable {
        launchRevenue += msg.value;
    }

    function setTradeFees(uint16 bp, uint16 bc, uint16 sp, uint16 sb) external {
        buyPlatformFeeBps = bp;
        buyCreatorFeeBps = bc;
        sellPlatformFeeBps = sp;
        sellBurnFeeBps = sb;
    }

    function setLaunchFee(uint256 amount) external {
        launchFee = amount;
    }
}
