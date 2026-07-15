// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {FeePolicy} from "../src/FeePolicy.sol";
import {BaseRevenueRouterV2} from "../src/BaseRevenueRouterV2.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {DirectLaunchFactoryBase} from "../src/DirectLaunchFactoryBase.sol";
import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";

contract UnifiedFeeHookV4ForkTest is Test {
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address private constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address private constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address private constant ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant BLUE = 0xb200000000000000000000Af2d07754b927109bc;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    receive() external payable {}

    function testForkBuySellRoutesEthAndBurnsOnlySellFee() public {
        if (block.chainid != 8453) return;
        FeePolicy policy = new FeePolicy(address(this), address(0xB0B));
        BaseRevenueRouterV2 revenue = new BaseRevenueRouterV2(
            BLUE, address(this), address(0xB0B), policy, address(0xBEEF), 7 days, 30 days
        );
        UnifiedFeeHook hook = _deployHook(policy, revenue);
        DirectDexLiquidityLocker locker = new DirectDexLiquidityLocker(
            address(this),
            address(revenue),
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(address(hook))
        );
        DirectErc20LaunchFactory factory =
            new DirectErc20LaunchFactory(address(this), locker, policy, revenue, _config());
        locker.setFactory(address(factory));
        factory.setLaunchRouter(ROUTER);
        address[] memory lockers = new address[](1);
        lockers[0] = address(locker);
        hook.configureLockers(lockers);

        vm.deal(address(this), 2 ether);
        DirectLaunchFactoryBase.TokenMetadata memory metadata = DirectLaunchFactoryBase.TokenMetadata({
            name: "Unified Hook Fork",
            symbol: "UHF",
            contractURI: "ipfs://unified-hook",
            salt: keccak256("unified-hook-fork")
        });
        (, address token, bytes32 poolId,) = factory.createLaunchWithInitialBuy{value: 0.101 ether}(
            metadata, factory.launchConfigHash(), block.timestamp + 1 hours, 1
        );
        UnifiedFeeHook.PoolKey memory poolKey = UnifiedFeeHook.PoolKey({
            currency0: address(0), currency1: token, fee: 0x800000, tickSpacing: 200, hooks: address(hook)
        });
        vm.expectRevert(UnifiedFeeHook.ExactOutputUnsupported.selector);
        vm.prank(POOL_MANAGER);
        hook.beforeSwap(
            address(this),
            poolKey,
            UnifiedFeeHook.SwapParams({zeroForOne: true, amountSpecified: 1, sqrtPriceLimitX96: 0}),
            bytes("")
        );
        uint256 bought = IERC20Minimal(token).balanceOf(address(this));
        assertGt(bought, 0);
        assertGt(hook.creatorNativeRevenue(poolId), 0);
        uint256 pendingCreator = hook.pendingCreatorRevenue(address(this));
        assertGt(pendingCreator, 0);
        uint256 creatorRecipientBefore = address(0xC0FFEE).balance;
        hook.claimCreatorRevenue(payable(address(0xC0FFEE)));
        assertEq(address(0xC0FFEE).balance, creatorRecipientBefore + pendingCreator);
        assertEq(hook.pendingCreatorRevenue(address(this)), 0);
        assertGt(revenue.pendingTreasuryRevenue(), 0);
        assertGt(revenue.vault().accountedRewardBalance(), 0);

        uint256 sellAmount = bought / 4;
        IERC20Minimal(token).approve(PERMIT2, type(uint256).max);
        IPermit2AllowanceTransfer(PERMIT2).approve(token, ROUTER, type(uint160).max, type(uint48).max);
        uint256 burnedBefore = IERC20Minimal(token).balanceOf(DEAD);
        _sell(token, address(hook), sellAmount);
        uint256 burned = IERC20Minimal(token).balanceOf(DEAD) - burnedBefore;
        assertEq(burned, (sellAmount * 30) / 10_000);
        assertGt(hook.platformNativeRevenue(poolId), 0);
        assertEq(hook.pendingCreatorRevenue(address(this)), 0);
    }

    function _sell(address token, address hook, uint256 amount) private {
        UnifiedRouter.ExactInputSingleParams memory swap = UnifiedRouter.ExactInputSingleParams({
            poolKey: IUniswapV4PositionManager.PoolKey({
                currency0: address(0), currency1: token, fee: 0x800000, tickSpacing: 200, hooks: hook
            }),
            zeroForOne: false,
            amountIn: uint128(amount),
            amountOutMinimum: 0,
            hookData: bytes("")
        });
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(swap);
        params[1] = abi.encode(token, amount);
        params[2] = abi.encode(address(0), 0);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(bytes(hex"060c0f"), params);
        UnifiedRouter(ROUTER).execute(hex"10", inputs, block.timestamp + 1 hours);
    }

    function _config() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 0x800000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            initialSqrtPriceX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 10_000,
            creatorShareBps: 0
        });
    }

    function _deployHook(FeePolicy policy, BaseRevenueRouterV2 revenue) private returns (UnifiedFeeHook hook) {
        bytes memory initCode = abi.encodePacked(
            type(UnifiedFeeHook).creationCode, abi.encode(address(this), POOL_MANAGER, policy, revenue)
        );
        bytes32 hash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, hash))))
            );
            if ((uint160(predicted) & ALL_HOOK_MASK) == HOOK_FLAGS) break;
        }
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && predicted.code.length != 0, "HOOK_DEPLOY_FAILED");
        return UnifiedFeeHook(payable(predicted));
    }
}

interface UnifiedRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
