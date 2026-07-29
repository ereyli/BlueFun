// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StakingTimelock} from "../src/StakingTimelock.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
import {ArcRevenueRouter} from "../src/arc/ArcRevenueRouter.sol";
import {ArcV3DirectAdapter} from "../src/arc/ArcV3DirectAdapter.sol";
import {ArcV3LiquidityLocker} from "../src/arc/ArcV3LiquidityLocker.sol";
import {
    IArcNativeUSDC,
    IArcV3Factory,
    IArcV3PositionManager,
    IArcV3SwapRouter
} from "../src/arc/ArcV3Interfaces.sol";
import {
    IStableNonfungiblePositionManager,
    IStableUniswapV3Factory
} from "../src/stable/StableUniswapV3Interfaces.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";

interface VmArcReadyFork {
    function deal(address account, uint256 balance) external;
}

contract ArcV3DirectReadyForkTest {
    VmArcReadyFork private constant VM =
        VmArcReadyFork(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant USDC = 0x3600000000000000000000000000000000000000;
    address private constant V3_FACTORY = 0xf0db7b58379503491d857dB50AC9ece64c653918;
    address private constant POSITION_MANAGER = 0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377;
    address private constant SWAP_ROUTER = 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77;
    address private constant GUARDIAN = address(0xA11CE);
    address private constant TREASURY = address(0xBEEF);

    function testReadyGenerationLaunchesImmediatelyAndFreezesAdapter() external {
        if (block.chainid != 5_042) return;
        VM.deal(address(this), 10 ether);
        StakingTimelock governance = new StakingTimelock(address(this), GUARDIAN, 7 days);
        ArcFeePolicy policy = new ArcFeePolicy(address(this), GUARDIAN);
        ArcDexAdapterRegistry registry = new ArcDexAdapterRegistry(address(this));
        ArcRevenueRouter revenueRouter =
            new ArcRevenueRouter(address(this), policy, TREASURY, TREASURY);
        ArcDirectLaunchFactory directFactory =
            new ArcDirectLaunchFactory(registry, policy, revenueRouter);
        ArcV3LiquidityLocker locker = new ArcV3LiquidityLocker(
            address(this),
            USDC,
            TREASURY,
            IStableUniswapV3Factory(V3_FACTORY),
            IStableNonfungiblePositionManager(POSITION_MANAGER),
            StableV3LiquidityLocker.CurveConfig({
                canonicalTickLower: -572_600,
                canonicalTickUpper: 400_600,
                canonicalInitialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630_000_000
            })
        );
        ArcV3DirectAdapter adapter = new ArcV3DirectAdapter(
            address(directFactory),
            IArcNativeUSDC(USDC),
            IArcV3Factory(V3_FACTORY),
            IArcV3PositionManager(POSITION_MANAGER),
            IArcV3SwapRouter(SWAP_ROUTER),
            locker
        );
        locker.setFactory(address(adapter));
        registry.setDirectAdapter(address(adapter), adapter.configHash());
        registry.freezeDirectAdapter();
        policy.unpauseNewLaunches();
        policy.proposeAdmin(address(governance));
        registry.proposeAdmin(address(governance));
        revenueRouter.proposeAdmin(address(governance));

        (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) =
            directFactory.createLaunch{value: 2 ether}(
                ArcDirectLaunchFactory.TokenMetadata({
                    name: "Arc Ready Test",
                    symbol: "ARCT",
                    contractURI: "ipfs://arc-ready-test",
                    salt: keccak256("ARC_READY_FORK_V1")
                }),
                block.timestamp + 20 minutes
            );

        require(launchId == 1, "BAD_LAUNCH_ID");
        require(token != address(0) && poolId != bytes32(0) && positionId != bytes32(0), "LAUNCH_FAILED");
        require(registry.directAdapterFrozen(), "ADAPTER_NOT_FROZEN");
        require(!policy.newLaunchesPaused(), "LAUNCHES_PAUSED");
        require(policy.pendingAdmin() == address(governance), "POLICY_HANDOFF_MISSING");
        require(registry.pendingAdmin() == address(governance), "REGISTRY_HANDOFF_MISSING");
        require(revenueRouter.pendingAdmin() == address(governance), "ROUTER_HANDOFF_MISSING");
    }
}
