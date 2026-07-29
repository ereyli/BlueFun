// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {IERC20Minimal} from "../src/UniswapV4LiquidityLocker.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
import {ArcRevenueRouter} from "../src/arc/ArcRevenueRouter.sol";
import {ArcV3DirectAdapter} from "../src/arc/ArcV3DirectAdapter.sol";
import {ArcV3LiquidityLocker} from "../src/arc/ArcV3LiquidityLocker.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";
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

contract ArcV3DirectForkTest is Test {
    address private constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address private constant V3_FACTORY = 0xf0db7b58379503491d857dB50AC9ece64c653918;
    address private constant POSITION_MANAGER = 0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377;
    address private constant SWAP_ROUTER = 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77;
    address private constant FUNDED_CREATOR = 0xA860919Cb28df3f45C154A28c66F25194cE80546;
    address private constant TREASURY = 0x000000000000000000000000000000000000B10E;
    uint256 private constant LAUNCH_FEE = 2 ether;

    function testForkCreatesLivePoolAndPermanentCustody() public {
        if (block.chainid != 5_042) return;
        assertTrue(ARC_USDC.code.length != 0);
        assertTrue(V3_FACTORY.code.length != 0);
        assertTrue(POSITION_MANAGER.code.length != 0);
        assertTrue(SWAP_ROUTER.code.length != 0);

        ArcFeePolicy policy = new ArcFeePolicy(address(this), address(0xB0B));
        ArcDexAdapterRegistry registry = new ArcDexAdapterRegistry(address(this));
        ArcRevenueRouter revenue = new ArcRevenueRouter(address(this), policy, TREASURY, TREASURY);
        ArcDirectLaunchFactory factory = new ArcDirectLaunchFactory(registry, policy, revenue);
        ArcV3LiquidityLocker locker = new ArcV3LiquidityLocker(
            address(this),
            ARC_USDC,
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
            address(factory),
            IArcNativeUSDC(ARC_USDC),
            IArcV3Factory(V3_FACTORY),
            IArcV3PositionManager(POSITION_MANAGER),
            IArcV3SwapRouter(SWAP_ROUTER),
            locker
        );
        locker.setFactory(address(adapter));
        registry.setDirectAdapter(address(adapter), adapter.configHash());
        registry.freezeDirectAdapter();
        policy.unpauseNewLaunches();
        assertTrue(adapter.isReady());

        uint256 initialNativeBalance = FUNDED_CREATOR.balance;
        assertGt(initialNativeBalance, LAUNCH_FEE);

        ArcDirectLaunchFactory.TokenMetadata memory metadata = ArcDirectLaunchFactory.TokenMetadata({
            name: "BlueFun Arc Fork",
            symbol: "BFAF",
            contractURI: "ipfs://bluefun-arc-v3-fork",
            salt: keccak256("bluefun-arc-v3-direct-fork")
        });

        vm.startPrank(FUNDED_CREATOR);
        (, address token, bytes32 poolId, bytes32 positionId) =
            factory.createLaunch{value: LAUNCH_FEE}(metadata, block.timestamp + 1 hours);
        vm.stopPrank();

        assertTrue(poolId != bytes32(0));
        assertTrue(positionId != bytes32(0));
        assertEq(IERC20Minimal(token).balanceOf(FUNDED_CREATOR), 0);
        assertEq(revenue.pendingTreasuryUsdc(), LAUNCH_FEE);
        assertEq(address(adapter).balance, 0);
        assertEq(IArcNativeUSDC(ARC_USDC).balanceOf(address(adapter)), 0);

        (,,,, uint256 tokenId,,,,,) = locker.lockedPositions(positionId);
        assertEq(IStableNonfungiblePositionManager(POSITION_MANAGER).ownerOf(tokenId), address(locker));
    }
}
