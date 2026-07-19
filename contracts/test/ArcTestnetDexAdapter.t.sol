// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {ArcBondingCurveMarket} from "../src/arc/ArcBondingCurveMarket.sol";
import {ArcBondLaunchFactory} from "../src/arc/ArcBondLaunchFactory.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
import {ArcGraduationCoordinator} from "../src/arc/ArcGraduationCoordinator.sol";
import {ArcRevenueRouter} from "../src/arc/ArcRevenueRouter.sol";
import {ArcTestnetDexAdapter} from "../src/arc/ArcTestnetDexAdapter.sol";

contract ArcTestnetDexAdapterTest is Test {
    ArcFeePolicy policy;
    ArcRevenueRouter router;
    ArcDexAdapterRegistry registry;
    ArcBondingCurveMarket market;
    ArcGraduationCoordinator graduation;
    ArcBondLaunchFactory bondFactory;
    ArcDirectLaunchFactory directFactory;
    ArcTestnetDexAdapter adapter;

    address creator = address(0xCAFE);
    address trader = address(0xB0B);

    function setUp() public {
        policy = new ArcFeePolicy(address(this), address(0xBEEF));
        registry = new ArcDexAdapterRegistry(address(this));
        router = new ArcRevenueRouter(address(this), policy, address(0xA11CE), address(0xB1D6E));
        market = new ArcBondingCurveMarket(address(this), policy, router);
        graduation = new ArcGraduationCoordinator(market, registry);
        bondFactory = new ArcBondLaunchFactory(market, address(graduation), registry, policy, router);
        directFactory = new ArcDirectLaunchFactory(registry, policy, router);
        adapter = new ArcTestnetDexAdapter(address(this), policy, router);

        market.configure(address(bondFactory), address(graduation), address(router));
        adapter.configureCallers(address(graduation), address(directFactory));
        adapter.freezeCallers();
        registry.setBondAdapter(address(adapter));
        registry.setDirectAdapter(address(adapter), adapter.directConfigHash());
        registry.freezeBondAdapter();
        registry.freezeDirectAdapter();
        policy.unpauseNewLaunches();
        vm.deal(creator, 10_000 ether);
        vm.deal(trader, 100 ether);
    }

    function testDirectLaunchBuySellFeeAndBurn() public {
        ArcDirectLaunchFactory.TokenMetadata memory metadata = ArcDirectLaunchFactory.TokenMetadata(
            "Arc Test Direct", "ATD", "ipfs://arc-test-direct", keccak256("arc-test-direct")
        );
        vm.prank(creator);
        (, address token,,) =
            directFactory.createLaunchWithInitialBuy{value: 2.5 ether}(metadata, block.timestamp + 1 hours, 0);
        uint256 creatorTokens = StandardLaunchToken(token).balanceOf(creator);
        assertGt(creatorTokens, 0);
        assertLe(creatorTokens, 50_000_000 ether);

        vm.prank(trader);
        uint256 traderTokens = adapter.buy{value: 0.25 ether}(token, 0, block.timestamp + 1 hours);
        assertGt(traderTokens, 0);

        uint256 sellAmount = creatorTokens / 2;
        vm.prank(creator);
        StandardLaunchToken(token).approve(address(adapter), sellAmount);
        uint256 balanceBefore = creator.balance;
        vm.prank(creator);
        uint256 usdcOut = adapter.sell(token, sellAmount, 0, block.timestamp + 1 hours);
        assertGt(usdcOut, 0);
        assertEq(creator.balance, balanceBefore + usdcOut);
        assertGt(StandardLaunchToken(token).balanceOf(adapter.DEAD_WALLET()), 0);
        assertGt(router.pendingBridgeUsdc(), 0);
    }

    function testGraduatedBondTradesThroughPermanentTestnetPool() public {
        ArcBondLaunchFactory.TokenMetadata memory metadata =
            ArcBondLaunchFactory.TokenMetadata("Arc Test Bond", "ATB", "ipfs://arc-test-bond", keccak256("atb"));
        BondingCurveMarket.CurveConfig memory curve =
            BondingCurveMarket.CurveConfig(1_000_000_000 ether, 1_250 ether, 5_000 ether, 1_000_000_000 ether);
        BondingCurveMarket.LaunchConfig memory config =
            BondingCurveMarket.LaunchConfig(900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether);

        vm.prank(creator);
        (uint256 launchId, address token) = bondFactory.createLaunch{value: 2 ether}(metadata, curve, config);
        vm.warp(block.timestamp + 61);
        vm.prank(creator);
        market.buy{value: 5_000 ether}(launchId, 0, block.timestamp + 1 hours);
        graduation.graduate(launchId);

        vm.prank(trader);
        uint256 bought = adapter.buy{value: 1 ether}(token, 0, block.timestamp + 1 hours);
        assertGt(bought, 0);
        vm.prank(trader);
        StandardLaunchToken(token).approve(address(adapter), bought / 2);
        vm.prank(trader);
        uint256 soldFor = adapter.sell(token, bought / 2, 0, block.timestamp + 1 hours);
        assertGt(soldFor, 0);

        (,,,,,,, bool exists) = adapter.pools(token);
        assertTrue(exists);
    }
}
