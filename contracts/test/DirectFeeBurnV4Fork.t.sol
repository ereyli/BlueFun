// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {DirectLaunchFactoryBase} from "../src/DirectLaunchFactoryBase.sol";
import {DirectFeeBurnHook} from "../src/DirectFeeBurnHook.sol";
import {MockVNextPolicyRouter} from "./mocks/MockVNextPolicyRouter.sol";
import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";

contract DirectFeeBurnV4ForkTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant BASE_POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant BASE_POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant BASE_STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant BASE_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address internal constant ROBINHOOD_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant ROBINHOOD_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant ROBINHOOD_STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant ROBINHOOD_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    receive() external payable {}

    function testForkAtomicInitialBuySellNativeFeeAndTokenBurn() public {
        if (block.chainid != 8453 && block.chainid != 4663) return;
        address positionManager = block.chainid == 8453 ? BASE_POSITION_MANAGER : ROBINHOOD_POSITION_MANAGER;
        address poolManager = block.chainid == 8453 ? BASE_POOL_MANAGER : ROBINHOOD_POOL_MANAGER;
        address stateView = block.chainid == 8453 ? BASE_STATE_VIEW : ROBINHOOD_STATE_VIEW;
        address router = block.chainid == 8453 ? BASE_ROUTER : ROBINHOOD_ROUTER;
        address platform = address(0xFEE);
        DirectFeeBurnHook hook = _deployHook(poolManager, platform);
        DirectDexLiquidityLocker locker = new DirectDexLiquidityLocker(
            address(this),
            platform,
            IUniswapV4PositionManager(positionManager),
            IUniswapV4StateView(stateView),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(address(hook))
        );
        MockVNextPolicyRouter vnext = new MockVNextPolicyRouter();
        vnext.setLaunchFee(0.002 ether);
        DirectErc20LaunchFactory factory =
            new DirectErc20LaunchFactory(address(this), locker, vnext, vnext, _config());
        locker.setFactory(address(factory));
        factory.setLaunchRouter(router);
        address[] memory lockers = new address[](1);
        lockers[0] = address(locker);
        hook.configureLockers(lockers);

        vm.deal(address(this), 2 ether);
        DirectLaunchFactoryBase.TokenMetadata memory metadata = DirectLaunchFactoryBase.TokenMetadata({
            name: "Fee Burn Fork", symbol: "FBF", contractURI: "ipfs://fee-burn", salt: keccak256("fee-burn")
        });
        (, address token,, bytes32 positionId) = factory.createLaunchWithInitialBuy{value: 0.102 ether}(
            metadata, factory.launchConfigHash(), block.timestamp + 1 hours, 1
        );
        uint256 creatorTokens = IERC20Minimal(token).balanceOf(address(this));
        assertGt(creatorTokens, 0);
        assertTrue(creatorTokens <= factory.MAX_INITIAL_BUY_TOKENS());

        locker.collectFees(positionId);
        assertGt(locker.pendingFees(address(this), address(0)), 0);
        assertGt(locker.pendingFees(platform, address(0)), 0);
        assertEq(locker.pendingFees(address(this), token), 0);

        uint256 sellAmount = creatorTokens / 4;
        IERC20Minimal(token).approve(PERMIT2, type(uint256).max);
        IPermit2AllowanceTransfer(PERMIT2).approve(token, router, type(uint160).max, type(uint48).max);
        uint256 platformNativeBefore = platform.balance;
        _sell(router, token, address(hook), sellAmount);
        assertGt(platform.balance, platformNativeBefore);

        locker.collectFees(positionId);
        assertGt(IERC20Minimal(token).balanceOf(DEAD), 0);
        assertEq(locker.pendingFees(address(this), token), 0);
        assertEq(locker.pendingFees(platform, token), 0);
    }

    function _sell(address router, address token, address hook, uint256 amount) private {
        V4ForkRouter.ExactInputSingleParams memory swap = V4ForkRouter.ExactInputSingleParams({
            poolKey: IUniswapV4PositionManager.PoolKey({
                currency0: address(0),
                currency1: token,
                fee: 0x800000,
                tickSpacing: 200,
                hooks: hook
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
        V4ForkRouter(router).execute(hex"10", inputs, block.timestamp + 1 hours);
    }

    function _config() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 0x800000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            initialSqrtPriceX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }

    function _deployHook(address poolManager, address platform) private returns (DirectFeeBurnHook hook) {
        bytes memory initCode = abi.encodePacked(
            type(DirectFeeBurnHook).creationCode, abi.encode(address(this), poolManager, platform)
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash)))));
            if ((uint160(predicted) & 0x3fff) == 0x20c4) break;
        }
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && predicted.code.length > 0, "HOOK_DEPLOY_FAILED");
        return DirectFeeBurnHook(predicted);
    }
}

interface V4ForkRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
