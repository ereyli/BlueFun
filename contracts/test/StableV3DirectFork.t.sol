// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {IERC20Minimal} from "../src/UniswapV4LiquidityLocker.sol";
import {FullMath} from "../src/libraries/FullMath.sol";
import {StableFeePolicy} from "../src/stable/StableFeePolicy.sol";
import {StableRevenueRouter} from "../src/stable/StableRevenueRouter.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";
import {IStableUSDT0, StableV3DirectLaunchFactory} from "../src/stable/StableV3DirectLaunchFactory.sol";
import {
    IStableNonfungiblePositionManager,
    IStableSwapRouter02,
    IStableUniswapV3Factory,
    IStableUniswapV3Pool
} from "../src/stable/StableUniswapV3Interfaces.sol";

contract StableV3DirectForkTest is Test {
    address private constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address private constant V3_FACTORY = 0x88F0a512eF09175D456bc9547f914f48C013E4aA;
    address private constant POSITION_MANAGER = 0x3BdC3437405f7D801b6036532713fc1F179136a6;
    address private constant SWAP_ROUTER = 0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a;
    address private constant SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    address private constant FUNDED_USDT0_HOLDER = 0x2ec21b3A2a8f02Af6685aBa1c5394d03081EBEFF;
    uint256 private constant LAUNCH_FEE = 0.001 ether;

    receive() external payable {}

    function testForkLaunchBuySellCollectAndPermanentCustody() public {
        if (block.chainid != 988) return;
        assertTrue(USDT0.code.length != 0);
        assertTrue(V3_FACTORY.code.length != 0);
        assertTrue(POSITION_MANAGER.code.length != 0);
        assertTrue(SWAP_ROUTER.code.length != 0);

        StableFeePolicy policy = new StableFeePolicy(address(this), address(0xB0B), LAUNCH_FEE);
        StableRevenueRouter revenue = new StableRevenueRouter(address(this), SAFE);
        StableV3LiquidityLocker locker = new StableV3LiquidityLocker(
            address(this),
            USDT0,
            SAFE,
            IStableUniswapV3Factory(V3_FACTORY),
            IStableNonfungiblePositionManager(POSITION_MANAGER),
            StableV3LiquidityLocker.CurveConfig({
                canonicalTickLower: -572_600,
                canonicalTickUpper: 400_600,
                canonicalInitialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630_000_000
            })
        );
        StableV3DirectLaunchFactory factory = new StableV3DirectLaunchFactory(
            address(this),
            locker,
            policy,
            revenue,
            IStableUSDT0(USDT0),
            IStableSwapRouter02(SWAP_ROUTER)
        );
        locker.setFactory(address(factory));

        vm.deal(address(this), 10 ether);
        // `vm.deal` bypasses Stable's native/ERC-20 synchronization. Seed the
        // creator's ERC-20 side from an existing fork holder so the local EVM can exercise v3.
        vm.prank(FUNDED_USDT0_HOLDER);
        IERC20Minimal(USDT0).transfer(address(this), 1_000_000);
        IERC20Minimal(USDT0).approve(address(factory), 1_000_000);
        StableV3DirectLaunchFactory.TokenMetadata memory metadata = StableV3DirectLaunchFactory.TokenMetadata({
            name: "BlueFun Stable Fork",
            symbol: "BFSF",
            contractURI: "ipfs://stable-fork",
            salt: keccak256("bluefun-stable-v3-fork")
        });
        (, address token,, bytes32 positionId) = factory.createLaunchWithInitialBuy{value: LAUNCH_FEE}(
            metadata, factory.launchConfigHash(), block.timestamp + 1 hours, 1_000_000, 1
        );
        (,,, address pool,,,,,,) = locker.lockedPositions(positionId);
        uint256 bought = IERC20Minimal(token).balanceOf(address(this));
        assertGt(bought, 0);
        assertEq(revenue.pendingTreasuryRevenue(), LAUNCH_FEE);
        uint256 marketCapUSDT0 = _marketCapUSDT0(pool, token);
        assertGt(marketCapUSDT0, 3_500 ether);
        assertLe(marketCapUSDT0, 5_000 ether);

        locker.collectFees(positionId);
        assertGt(locker.pendingFees(address(this), USDT0), 0);
        assertGt(locker.pendingFees(SAFE, USDT0), 0);

        uint256 sellAmount = bought / 4;
        IERC20Minimal(token).approve(SWAP_ROUTER, sellAmount);
        IStableSwapRouter02(SWAP_ROUTER).exactInputSingle(
            IStableSwapRouter02.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: USDT0,
                fee: 10_000,
                recipient: address(this),
                amountIn: sellAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        locker.collectFees(positionId);
        assertGt(IERC20Minimal(token).balanceOf(locker.DEAD_WALLET()), 0);
        assertGt(locker.pendingFees(SAFE, token), 0);

        (,,,, uint256 tokenId,,,,,) = locker.lockedPositions(positionId);
        assertEq(_ownerOf(tokenId), address(locker));
    }

    function _ownerOf(uint256 tokenId) private view returns (address owner) {
        (bool ok, bytes memory data) =
            POSITION_MANAGER.staticcall(abi.encodeWithSignature("ownerOf(uint256)", tokenId));
        require(ok);
        owner = abi.decode(data, (address));
    }

    function _marketCapUSDT0(address pool, address token) private view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = IStableUniswapV3Pool(pool).slot0();
        uint256 sqrtPrice = uint256(sqrtPriceX96);
        uint256 squaredPrice = sqrtPrice * sqrtPrice;
        uint256 q192 = 2 ** 192;
        return USDT0 < token
            ? FullMath.mulDiv(q192, 1e39, squaredPrice)
            : FullMath.mulDiv(squaredPrice, 1e39, q192);
    }
}
