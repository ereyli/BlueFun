// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {MonadFeePolicy} from "../src/monad/MonadFeePolicy.sol";
import {MonadRevenueRouter} from "../src/monad/MonadRevenueRouter.sol";
import {MonadLaunchFactory} from "../src/monad/MonadLaunchFactory.sol";
import {MockLiquidityLocker} from "./mocks/MockLiquidityLocker.sol";

contract MonadLaunchpadTest is Test {
    address private constant CREATOR = address(0xCAFE);
    address private constant TREASURY = address(0xBEEF);
    address private constant GUARDIAN = address(0xB0B);

    MonadFeePolicy policy;
    MonadRevenueRouter router;
    BondingCurveMarket market;
    Erc20GraduationManager graduation;
    MonadLaunchFactory factory;
    MockLiquidityLocker locker;

    function setUp() public {
        policy = new MonadFeePolicy(address(this), GUARDIAN, 80 ether);
        router = new MonadRevenueRouter(address(this), TREASURY);
        locker = new MockLiquidityLocker();
        market = new BondingCurveMarket(address(this), policy, router);
        graduation = new Erc20GraduationManager(market, locker);
        factory = new MonadLaunchFactory(address(this), market, address(graduation), policy, router);
        market.configure(address(factory), address(graduation), address(router));
        vm.deal(CREATOR, 1_000_000 ether);
    }

    function testMonadEconomicsAndTreasuryRouting() public {
        (uint256 launchId, address token) = _launch(1_000 ether);
        assertEq(launchId, 1);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        assertEq(router.pendingTreasuryRevenue(), 80 ether + (920 ether * 70) / 10_000);
        assertEq(market.pendingFees(CREATOR), (920 ether * 30) / 10_000);

        (,, uint256 virtualToken, uint256 virtualMon,, uint256 grossRaised, uint256 target,,,,,,,,,,) =
            market.launches(launchId);
        assertTrue(virtualToken < 1_000_000_000 ether);
        assertTrue(virtualMon > 100_000 ether);
        assertEq(grossRaised, 920 ether);
        assertEq(target, 400_000 ether);
    }

    function testSellPaysMonAndBurnsExactlyThirtyBpsOfTokenInput() public {
        (uint256 launchId, address token) = _launch(10_000 ether);
        uint256 sellAmount = StandardLaunchToken(token).balanceOf(CREATOR) / 2;
        uint256 deadBefore = StandardLaunchToken(token).balanceOf(address(0xdead));
        uint256 monBefore = CREATOR.balance;
        vm.startPrank(CREATOR);
        StandardLaunchToken(token).approve(address(market), sellAmount);
        market.sell(launchId, sellAmount, 0, block.timestamp + 1 hours);
        vm.stopPrank();
        assertGt(CREATOR.balance, monBefore);
        assertEq(StandardLaunchToken(token).balanceOf(address(0xdead)) - deadBefore, (sellAmount * 30) / 10_000);
    }

    function testGraduationLocksMonAndRemainingSupply() public {
        (uint256 launchId, address token) = _launch(80 ether);
        vm.warp(block.timestamp + 61);
        vm.prank(CREATOR);
        market.buy{value: 400_000 ether}(launchId, 0, block.timestamp + 1 hours);
        graduation.graduate(launchId);
        (,,,,,,,,,,,,,,,, bool graduated) = market.launches(launchId);
        assertTrue(graduated);
        assertEq(StandardLaunchToken(token).balanceOf(address(market)), 0);
        assertTrue(StandardLaunchToken(token).balanceOf(address(locker)) > 0);
        assertTrue(address(locker).balance > 0);
    }

    function testTreasuryClaimCanOnlyReachConfiguredSafe() public {
        router.depositTradeRevenue{value: 12 ether}();
        uint256 beforeBalance = TREASURY.balance;
        router.claimTreasuryRevenue();
        assertEq(TREASURY.balance, beforeBalance + 12 ether);
        assertEq(router.pendingTreasuryRevenue(), 0);
    }

    function testLaunchFeeCapAndGuardianPause() public {
        vm.expectRevert(MonadFeePolicy.InvalidFee.selector);
        policy.setLaunchFee(501 ether, 0);
        vm.prank(GUARDIAN);
        policy.pauseNewLaunches();
        vm.expectRevert(MonadLaunchFactory.LaunchesPaused.selector);
        _launch(80 ether);
    }

    function testMonadRevenueCannotBeRedirectedToBaseStaking() public {
        vm.expectRevert(MonadFeePolicy.InvalidFee.selector);
        policy.setTradeStakingShare(1);

        vm.expectRevert(MonadFeePolicy.InvalidFee.selector);
        policy.setLaunchFee(80 ether, 1);
    }

    function _launch(uint256 value) private returns (uint256 launchId, address token) {
        MonadLaunchFactory.TokenMetadata memory metadata = MonadLaunchFactory.TokenMetadata(
            "Monad Token", "MONAD", "ipfs://metadata", keccak256(abi.encode(value, block.timestamp))
        );
        BondingCurveMarket.CurveConfig memory curve = BondingCurveMarket.CurveConfig(
            1_000_000_000 ether, 100_000 ether, 400_000 ether, 1_000_000_000 ether
        );
        BondingCurveMarket.LaunchConfig memory config = BondingCurveMarket.LaunchConfig(
            900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether
        );
        vm.prank(CREATOR);
        return factory.createLaunch{value: value}(metadata, curve, config);
    }
}
