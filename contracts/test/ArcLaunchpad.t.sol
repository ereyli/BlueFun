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
import {MockArcDexAdapter} from "./mocks/MockArcDexAdapter.sol";

contract ArcLaunchpadTest is Test {
    bytes32 internal constant DIRECT_CONFIG_HASH = keccak256("ARC_UNISWAP_V4_CONFIG_V1");

    ArcFeePolicy policy;
    ArcRevenueRouter router;
    ArcDexAdapterRegistry registry;
    ArcBondingCurveMarket market;
    ArcGraduationCoordinator graduation;
    ArcBondLaunchFactory bondFactory;
    ArcDirectLaunchFactory directFactory;
    MockArcDexAdapter adapter;

    address creator = address(0xCAFE);
    address guardian = address(0xBEEF);
    address treasury = address(0xA11CE);
    address bridgeRecipient = address(0xB1D6E);

    function setUp() public {
        policy = new ArcFeePolicy(address(this), guardian);
        registry = new ArcDexAdapterRegistry(address(this));
        router = new ArcRevenueRouter(address(this), policy, treasury, bridgeRecipient);
        market = new ArcBondingCurveMarket(address(this), policy, router);
        graduation = new ArcGraduationCoordinator(market, registry);
        bondFactory = new ArcBondLaunchFactory(market, address(graduation), registry, policy, router);
        directFactory = new ArcDirectLaunchFactory(registry, policy, router);
        market.configure(address(bondFactory), address(graduation), address(router));
        adapter = new MockArcDexAdapter(DIRECT_CONFIG_HASH);
        vm.deal(creator, 20_000 ether);
    }

    function testArcPolicyStartsSafelyPausedWithTwoUsdcFee() public view {
        assertTrue(policy.newLaunchesPaused());
        assertEq(policy.launchFee(), 2 ether);
        assertEq(policy.MAX_LAUNCH_FEE(), 25 ether);
        assertEq(policy.buyPlatformFeeBps(), 70);
        assertEq(policy.buyCreatorFeeBps(), 30);
        assertEq(policy.sellPlatformFeeBps(), 70);
        assertEq(policy.sellBurnFeeBps(), 30);
    }

    function testLaunchFeeCanChangeButNeverExceedTwentyFiveUsdc() public {
        policy.setLaunchFee(25 ether, 0);
        assertEq(policy.launchFee(), 25 ether);
        vm.expectRevert(ArcFeePolicy.InvalidFee.selector);
        policy.setLaunchFee(25 ether + 1, 0);
    }

    function testBondCannotLaunchBeforeFrozenAdapter() public {
        policy.unpauseNewLaunches();
        vm.expectRevert(ArcBondLaunchFactory.AdapterNotFrozen.selector);
        vm.prank(creator);
        bondFactory.createLaunch{value: 2 ether}(_bondMetadata(), _curve(), _tradingConfig());
    }

    function testFrozenAdapterCannotBeReplaced() public {
        registry.setBondAdapter(address(adapter));
        registry.freezeBondAdapter();
        MockArcDexAdapter replacement = new MockArcDexAdapter(DIRECT_CONFIG_HASH);
        vm.expectRevert(ArcDexAdapterRegistry.AdapterFrozen.selector);
        registry.setBondAdapter(address(replacement));
    }

    function testCreatesArcBondWithFiveThousandUsdcTarget() public {
        _activateAdaptersAndLaunches();
        vm.prank(creator);
        (uint256 launchId, address token) =
            bondFactory.createLaunch{value: 2 ether}(_bondMetadata(), _curve(), _tradingConfig());

        BondingCurveMarket.LaunchState memory launch = market.arcLaunch(launchId);
        assertEq(launch.graduationEthTarget, 5_000 ether);
        assertEq(launch.virtualEthReserve, 1_250 ether);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        assertEq(router.pendingTreasuryUsdc(), 2 ether);
    }

    function testBondGraduatesThroughFrozenAdapter() public {
        _activateAdaptersAndLaunches();
        vm.prank(creator);
        (uint256 launchId, address token) =
            bondFactory.createLaunch{value: 2 ether}(_bondMetadata(), _curve(), _tradingConfig());

        vm.warp(block.timestamp + 61);
        vm.prank(creator);
        market.buy{value: 5_000 ether}(launchId, 0, block.timestamp + 1 hours);
        bytes32 positionId = graduation.graduate(launchId);

        BondingCurveMarket.LaunchState memory launch = market.arcLaunch(launchId);
        assertTrue(launch.graduated);
        assertTrue(positionId != bytes32(0));
        (uint256 recordedLaunch, address recordedToken, uint256 tokenAmount, uint256 usdcAmount,) =
            adapter.bondPositions(positionId);
        assertEq(recordedLaunch, launchId);
        assertEq(recordedToken, token);
        assertGt(tokenAmount, 0);
        assertEq(usdcAmount, 4_950 ether);
    }

    function testCreatesDirectLaunchOnlyThroughFrozenAdapter() public {
        _activateAdaptersAndLaunches();
        ArcDirectLaunchFactory.TokenMetadata memory metadata =
            ArcDirectLaunchFactory.TokenMetadata("Arc Direct", "ADIR", "ipfs://arc-direct", keccak256("arc-direct"));
        vm.prank(creator);
        (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) = directFactory.createLaunchWithInitialBuy{
            value: 102 ether
        }(
            metadata, block.timestamp + 1 hours, 100_000 ether
        );

        assertEq(launchId, 1);
        assertTrue(poolId != bytes32(0));
        assertTrue(positionId != bytes32(0));
        assertEq(StandardLaunchToken(token).balanceOf(creator), 100_000 ether);
        assertEq(StandardLaunchToken(token).balanceOf(address(adapter)), 999_900_000 ether);
        assertEq(router.pendingTreasuryUsdc(), 2 ether);
    }

    function testDirectNoBuyRouteRejectsAccidentalExtraUsdc() public {
        _activateAdaptersAndLaunches();
        ArcDirectLaunchFactory.TokenMetadata memory metadata = ArcDirectLaunchFactory.TokenMetadata(
            "Arc Direct", "ADIR", "ipfs://arc-direct", keccak256("arc-direct-extra")
        );
        vm.prank(creator);
        vm.expectRevert(ArcDirectLaunchFactory.InsufficientLaunchFee.selector);
        directFactory.createLaunch{value: 3 ether}(metadata, block.timestamp + 1 hours);
    }

    function _activateAdaptersAndLaunches() private {
        registry.setBondAdapter(address(adapter));
        registry.setDirectAdapter(address(adapter), DIRECT_CONFIG_HASH);
        registry.freezeBondAdapter();
        registry.freezeDirectAdapter();
        policy.unpauseNewLaunches();
    }

    function _bondMetadata() private pure returns (ArcBondLaunchFactory.TokenMetadata memory) {
        return ArcBondLaunchFactory.TokenMetadata("Arc Bond", "ABOND", "ipfs://arc-bond", keccak256("arc-bond"));
    }

    function _curve() private pure returns (BondingCurveMarket.CurveConfig memory) {
        return BondingCurveMarket.CurveConfig(1_000_000_000 ether, 1_250 ether, 5_000 ether, 1_000_000_000 ether);
    }

    function _tradingConfig() private pure returns (BondingCurveMarket.LaunchConfig memory) {
        return BondingCurveMarket.LaunchConfig(900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether);
    }
}
