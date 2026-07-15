// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {FeePolicy} from "../src/FeePolicy.sol";
import {BaseRevenueRouterV2} from "../src/BaseRevenueRouterV2.sol";
import {RemoteRevenueRouter} from "../src/RemoteRevenueRouter.sol";
import {BlueStakingVaultV2} from "../src/BlueStakingVaultV2.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";

contract VNextRevenueAndStakingTest is Test {
    address user = address(0xA11CE);
    address treasury = address(0xBEEF);
    address guardian = address(0xB0B);
    StandardLaunchToken blue;
    FeePolicy policy;
    BaseRevenueRouterV2 router;
    BlueStakingVaultV2 vault;

    function setUp() public {
        blue = new StandardLaunchToken("BLUE", "BLUE", "ipfs://blue", user, 1_000_000_000 ether);
        policy = new FeePolicy(address(this), guardian);
        router = new BaseRevenueRouterV2(
            address(blue), address(this), guardian, policy, treasury, 7 days, 30 days
        );
        vault = router.vault();
        vm.deal(address(this), 100 ether);
        vm.prank(user);
        blue.approve(address(vault), type(uint256).max);
    }

    function testTradeRevenueSplitsAndStreamsNativeEth() public {
        vm.prank(user);
        vault.stake(100 ether);
        router.depositTradeRevenue{value: 2 ether}();
        assertEq(router.pendingTreasuryRevenue(), 1 ether);
        assertEq(vault.accountedRewardBalance(), 1 ether);
        vm.warp(block.timestamp + 7 days);
        uint256 earned = vault.earned(user);
        assertGt(earned, 0.999 ether);
        uint256 beforeBalance = user.balance;
        vm.prank(user);
        vault.claimReward(payable(user));
        assertGt(user.balance, beforeBalance + 0.999 ether);
    }

    function testLaunchRevenueDefaultsEntirelyToTreasuryAndBridgeIsNotSplitAgain() public {
        vm.prank(user);
        vault.stake(100 ether);
        router.depositLaunchRevenue{value: 1 ether}();
        assertEq(router.pendingTreasuryRevenue(), 1 ether);
        assertEq(vault.accountedRewardBalance(), 0);
        router.depositBridgedStakerRevenue{value: 1 ether}();
        assertEq(vault.accountedRewardBalance(), 1 ether);
    }

    function testAdditionalUnstakeAggregatesResetsTimerAndSupportsPartialActions() public {
        vm.prank(user);
        vault.stake(100 ether);
        vm.prank(user);
        vault.requestUnstake(10 ether);
        uint256 firstEnd = vault.cooldownEnd(user);
        vm.warp(block.timestamp + 5 days);
        vm.prank(user);
        vault.requestUnstake(15 ether);
        assertEq(vault.coolingBalanceOf(user), 25 ether);
        assertGt(vault.cooldownEnd(user), firstEnd);
        vm.prank(user);
        vault.cancelUnstake(5 ether);
        assertEq(vault.coolingBalanceOf(user), 20 ether);
        vm.warp(vault.cooldownEnd(user));
        vm.prank(user);
        vault.withdraw(user, 7 ether);
        assertEq(vault.coolingBalanceOf(user), 13 ether);
        vm.prank(user);
        vault.withdraw(user, 13 ether);
        assertEq(vault.coolingBalanceOf(user), 0);
    }

    function testRemoteTradeRevenueSplitsToBridgeReserve() public {
        RemoteRevenueRouter remote = new RemoteRevenueRouter(address(this), policy, treasury, user);
        remote.depositTradeRevenue{value: 2 ether}();
        assertEq(remote.pendingTreasuryRevenue(), 1 ether);
        assertEq(remote.pendingBridgeReserve(), 1 ether);
        uint256 beforeBalance = user.balance;
        remote.releaseBridgeReserve();
        assertEq(user.balance, beforeBalance + 1 ether);
    }

    function testFeeCapsAndGuardianPause() public {
        vm.expectRevert(FeePolicy.InvalidFee.selector);
        policy.setTradeFees(150, 51, 70, 30);
        vm.prank(guardian);
        policy.pauseNewLaunches();
        assertTrue(policy.newLaunchesPaused());
        vm.expectRevert();
        vm.prank(guardian);
        policy.unpauseNewLaunches();
        policy.unpauseNewLaunches();
        assertFalse(policy.newLaunchesPaused());
    }
}
