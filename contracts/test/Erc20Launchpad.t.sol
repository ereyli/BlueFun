// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20LaunchFactory} from "../src/Erc20LaunchFactory.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {MockLiquidityLocker} from "./mocks/MockLiquidityLocker.sol";
import {MockVNextPolicyRouter} from "./mocks/MockVNextPolicyRouter.sol";

contract Erc20LaunchpadTest is Test {
    BondingCurveMarket market;
    Erc20LaunchFactory factory;
    Erc20GraduationManager graduation;
    MockLiquidityLocker locker;
    MockVNextPolicyRouter policyRouter;
    address creator = address(0xCAFE);

    function setUp() public {
        locker = new MockLiquidityLocker();
        policyRouter = new MockVNextPolicyRouter();
        policyRouter.setLaunchFee(0.002 ether);
        market = new BondingCurveMarket(address(this), policyRouter, policyRouter);
        graduation = new Erc20GraduationManager(market, locker);
        factory = new Erc20LaunchFactory(address(this), market, address(graduation), policyRouter, policyRouter);
        market.configure(address(factory), address(graduation), address(this));
        vm.deal(creator, 10 ether);
    }

    function testCreatesFixedSupplyErc20AndTrades() public {
        (uint256 launchId, address token) = _launch(0.102 ether);
        assertEq(launchId, 1);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        assertTrue(StandardLaunchToken(token).balanceOf(creator) > 0);
        assertTrue(StandardLaunchToken(token).balanceOf(address(market)) < 1_000_000_000 ether);
    }

    function testGraduationLocksAllRemainingLiquidity() public {
        (uint256 launchId, address token) = _launch(0.002 ether);
        vm.warp(block.timestamp + 61);
        vm.prank(creator);
        market.buy{value: 5 ether}(launchId, 0, block.timestamp + 1);
        graduation.graduate(launchId);
        (,,,,,,,,,,,,,,,, bool graduated) = market.launches(launchId);
        assertTrue(graduated);
        assertEq(StandardLaunchToken(token).balanceOf(address(market)), 0);
        assertTrue(StandardLaunchToken(token).balanceOf(address(locker)) > 0);
    }

    function testFuzzMarketRemainsSolventAcrossBuyAndSell(uint96 rawAmount) public {
        (uint256 launchId, address token) = _launch(0.002 ether);
        uint256 buyAmount = 0.001 ether + (uint256(rawAmount) % 4.8 ether);
        vm.deal(creator, buyAmount + 1 ether);
        vm.warp(block.timestamp + 61);
        vm.prank(creator);
        market.buy{value: buyAmount}(launchId, 0, block.timestamp + 1 hours);

        uint256 tokenBalance = StandardLaunchToken(token).balanceOf(creator);
        uint256 sellAmount = tokenBalance / 2;
        vm.prank(creator);
        StandardLaunchToken(token).approve(address(market), sellAmount);
        vm.prank(creator);
        market.sell(launchId, sellAmount, 0, block.timestamp + 1 hours);

        (,,,, uint256 realEthReserve,,,,,,,,,,,,) = market.launches(launchId);
        uint256 liabilities = realEthReserve + market.pendingFees(address(this)) + market.pendingFees(creator);
        assertEq(address(market).balance, liabilities);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
    }

    function testCopiedSaltCreatesDifferentTokenAndPreservesCreators() public {
        address attacker = address(0xBAD);
        vm.deal(attacker, 1 ether);
        Erc20LaunchFactory.TokenMetadata memory metadata =
            Erc20LaunchFactory.TokenMetadata("Same", "SAME", "ipfs://same", keccak256("same-salt"));
        BondingCurveMarket.CurveConfig memory curve =
            BondingCurveMarket.CurveConfig(1_000_000_000 ether, 1.25 ether, 5 ether, 1_000_000_000 ether);
        BondingCurveMarket.LaunchConfig memory config =
            BondingCurveMarket.LaunchConfig(900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether);

        vm.prank(attacker);
        (uint256 attackerLaunch, address attackerToken) =
            factory.createLaunch{value: 0.002 ether}(metadata, curve, config);
        vm.prank(creator);
        (uint256 creatorLaunch, address creatorToken) =
            factory.createLaunch{value: 0.002 ether}(metadata, curve, config);
        assertTrue(attackerToken != creatorToken);
        (, address recordedAttacker,,,,,,,,,,,,,,,) = market.launches(attackerLaunch);
        (, address recordedCreator,,,,,,,,,,,,,,,) = market.launches(creatorLaunch);
        assertEq(recordedAttacker, attacker);
        assertEq(recordedCreator, creator);
    }

    function _launch(uint256 value) private returns (uint256 launchId, address token) {
        Erc20LaunchFactory.TokenMetadata memory metadata =
            Erc20LaunchFactory.TokenMetadata("Robin Token", "ROBIN", "ipfs://metadata", keccak256("robin"));
        BondingCurveMarket.CurveConfig memory curve =
            BondingCurveMarket.CurveConfig(1_000_000_000 ether, 1.25 ether, 5 ether, 1_000_000_000 ether);
        BondingCurveMarket.LaunchConfig memory config =
            BondingCurveMarket.LaunchConfig(900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether);
        vm.prank(creator);
        return factory.createLaunch{value: value}(metadata, curve, config);
    }
}
