// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";
import {MockPoolInitializationHook} from "./mocks/MockPoolInitializationHook.sol";

contract RobinhoodV4LockerForkTest is Test {
    address internal constant HOOK = address(0x2000);
    address internal constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address internal constant GRADUATION_MANAGER = address(0xDAD);

    function testRobinhoodForkCollectsFeesWithoutUnlockingPrincipal() public {
        if (block.chainid != 4663) return;
        MockPoolInitializationHook template = new MockPoolInitializationHook();
        vm.etch(HOOK, address(template).code);
        MockPoolInitializationHook(HOOK).initialize(POOL_MANAGER);

        RobinhoodForkToken token = new RobinhoodForkToken();
        UniswapV4LiquidityLocker locker = new UniswapV4LiquidityLocker(
            address(this),
            address(this),
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            3_000,
            60,
            HOOK
        );
        MockPoolInitializationHook(HOOK).allowLocker(address(locker));
        locker.setGraduationManager(GRADUATION_MANAGER);
        token.mint(address(locker), 1_000_000_000 ether);
        vm.deal(GRADUATION_MANAGER, 10 ether);
        vm.deal(address(this), 1 ether);

        vm.prank(GRADUATION_MANAGER);
        bytes32 positionId = locker.lockLiquidity{value: 5 ether}(1, address(token), 1_000_000_000 ether, address(this));
        (,,,,, uint256 tokenId, uint128 liquidityBefore,,,) = locker.lockedPositions(positionId);

        RobinhoodSwapRouter.ExactInputSingleParams memory swap = RobinhoodSwapRouter.ExactInputSingleParams({
            poolKey: IUniswapV4PositionManager.PoolKey({
                currency0: address(0), currency1: address(token), fee: 3_000, tickSpacing: 60, hooks: HOOK
            }),
            zeroForOne: true,
            amountIn: uint128(0.1 ether),
            amountOutMinimum: 0,
            hookData: bytes("")
        });
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(swap);
        params[1] = abi.encode(address(0), 0.1 ether);
        params[2] = abi.encode(address(token), 0);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(bytes(hex"060c0f"), params);
        RobinhoodSwapRouter(UNIVERSAL_ROUTER).execute{value: 0.1 ether}(hex"10", inputs, block.timestamp + 1 hours);

        locker.collectFees(positionId);
        (uint256 nativeCollected,,,,,) = locker.feeRevenue(positionId);
        assertGt(nativeCollected, 0);
        assertGt(locker.pendingFees(address(this), address(0)), 0);
        assertEq(IUniswapV4PositionManager(POSITION_MANAGER).getPositionLiquidity(tokenId), liquidityBefore);
    }
}

interface RobinhoodSwapRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

contract RobinhoodForkToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
