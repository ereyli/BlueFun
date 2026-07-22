// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {MonadFeePolicy} from "../src/monad/MonadFeePolicy.sol";
import {MonadRevenueRouter} from "../src/monad/MonadRevenueRouter.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {DirectLaunchFactoryBase} from "../src/DirectLaunchFactoryBase.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {MonadLaunchFactory} from "../src/monad/MonadLaunchFactory.sol";
import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";

contract MonadUnifiedFeeHookV4ForkTest is Test {
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant POSITION_MANAGER = 0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016;
    address private constant POOL_MANAGER = 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e;
    address private constant STATE_VIEW = 0x77395F3b2E73aE90843717371294fa97cC419D64;
    address private constant ROUTER = 0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    receive() external payable {}

    function testForkDirectBuySellRoutesMonToSafeAndBurnsSellFee() public {
        if (block.chainid != 143) return;
        assertTrue(CREATE2_DEPLOYER.code.length != 0);
        assertTrue(POSITION_MANAGER.code.length != 0);
        assertTrue(POOL_MANAGER.code.length != 0);
        assertTrue(STATE_VIEW.code.length != 0);
        assertTrue(ROUTER.code.length != 0);
        assertTrue(PERMIT2.code.length != 0);

        MonadFeePolicy policy = new MonadFeePolicy(address(this), address(0xB0B), 80 ether);
        MonadRevenueRouter revenue = new MonadRevenueRouter(address(this), address(0xBEEF));
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

        vm.deal(address(this), 200 ether);
        DirectLaunchFactoryBase.TokenMetadata memory metadata = DirectLaunchFactoryBase.TokenMetadata({
            name: "Monad Fork Token",
            symbol: "MFT",
            contractURI: "ipfs://monad-fork",
            salt: keccak256("monad-unified-hook-fork")
        });
        (, address token, bytes32 poolId,) = factory.createLaunchWithInitialBuy{value: 100 ether}(
            metadata, factory.launchConfigHash(), block.timestamp + 1 hours, 1
        );

        uint256 bought = IERC20Minimal(token).balanceOf(address(this));
        assertGt(bought, 0);
        assertGt(hook.creatorNativeRevenue(poolId), 0);
        assertGt(hook.pendingCreatorRevenue(address(this)), 0);
        assertGt(revenue.pendingTreasuryRevenue(), 80 ether);

        uint256 sellAmount = bought / 4;
        IERC20Minimal(token).approve(PERMIT2, type(uint256).max);
        IPermit2AllowanceTransfer(PERMIT2).approve(token, ROUTER, type(uint160).max, type(uint48).max);
        uint256 burnedBefore = IERC20Minimal(token).balanceOf(DEAD);
        _sell(token, address(hook), sellAmount);
        assertEq(IERC20Minimal(token).balanceOf(DEAD) - burnedBefore, (sellAmount * 30) / 10_000);
        assertGt(hook.platformNativeRevenue(poolId), 0);
    }

    function testForkBondGraduatesIntoRealMonadV4() public {
        if (block.chainid != 143) return;
        MonadFeePolicy policy = new MonadFeePolicy(address(this), address(0xB0B), 80 ether);
        MonadRevenueRouter revenue = new MonadRevenueRouter(address(this), address(0xBEEF));
        UnifiedFeeHook hook = _deployHook(policy, revenue);
        BondingCurveMarket market = new BondingCurveMarket(address(this), policy, revenue);
        UniswapV4LiquidityLocker locker = new UniswapV4LiquidityLocker(
            address(this),
            address(revenue),
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            0x800000,
            60,
            address(hook)
        );
        Erc20GraduationManager graduation = new Erc20GraduationManager(market, locker);
        locker.setGraduationManager(address(graduation));
        MonadLaunchFactory factory =
            new MonadLaunchFactory(address(this), market, address(graduation), policy, revenue);
        market.configure(address(factory), address(graduation), address(revenue));
        address[] memory lockers = new address[](1);
        lockers[0] = address(locker);
        hook.configureLockers(lockers);

        vm.deal(address(this), 500_100 ether);
        MonadLaunchFactory.TokenMetadata memory metadata = MonadLaunchFactory.TokenMetadata({
            name: "Monad Bond Fork",
            symbol: "MBF",
            contractURI: "ipfs://monad-bond-fork",
            salt: keccak256("monad-bond-v4-fork")
        });
        BondingCurveMarket.CurveConfig memory curve = BondingCurveMarket.CurveConfig(
            1_000_000_000 ether, 100_000 ether, 400_000 ether, 1_000_000_000 ether
        );
        BondingCurveMarket.LaunchConfig memory config = BondingCurveMarket.LaunchConfig(
            900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether
        );
        (uint256 launchId, address token) = factory.createLaunch{value: 80 ether}(metadata, curve, config);
        vm.warp(block.timestamp + 61);
        market.buy{value: 400_000 ether}(launchId, 0, block.timestamp + 1 hours);
        bytes32 positionId = graduation.graduate(launchId);
        (,,,,, uint256 tokenId, uint128 liquidity,, uint24 usedFee,) = locker.lockedPositions(positionId);
        assertGt(uint256(positionId), 0);
        assertGt(tokenId, 0);
        assertGt(liquidity, 0);
        assertEq(usedFee, 0x800000);
        assertEq(IERC20Minimal(token).balanceOf(address(market)), 0);
    }

    function _sell(address token, address hook, uint256 amount) private {
        MonadUnifiedRouter.ExactInputSingleParams memory swap = MonadUnifiedRouter.ExactInputSingleParams({
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
        MonadUnifiedRouter(ROUTER).execute(hex"10", inputs, block.timestamp + 1 hours);
    }

    function _config() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 0x800000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 86_000,
            initialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630,
            platformShareBps: 10_000,
            creatorShareBps: 0
        });
    }

    function _deployHook(MonadFeePolicy policy, MonadRevenueRouter revenue)
        private
        returns (UnifiedFeeHook hook)
    {
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

interface MonadUnifiedRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
