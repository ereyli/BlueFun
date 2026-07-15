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

contract BaseV4LockerForkTest is Test {
    address internal constant HOOK = address(0x2000);
    address internal constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;

    address graduationManager = address(0xDAD);

    function testForkLocksLiquidityThroughRealBaseV4PositionManager() public {
        if (block.chainid != 8453) return;
        _installHook();

        ForkToken token = new ForkToken("Fork B20", "FB20");
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
        locker.setGraduationManager(graduationManager);
        token.mint(address(locker), 1_000_000_000 ether);
        vm.deal(graduationManager, 10 ether);

        vm.prank(graduationManager);
        bytes32 positionId = locker.lockLiquidity{value: 5 ether}(1, address(token), 1_000_000_000 ether, address(this));

        (,,,,, uint256 tokenId, uint128 liquidity,, uint24 usedFee,) = locker.lockedPositions(positionId);
        assertGt(uint256(positionId), 0);
        assertGt(tokenId, 0);
        assertGt(liquidity, 0);
        assertEq(usedFee, 3_000);
    }

    function testForkCollectsRealSwapFeesWithoutUnlockingPrincipal() public {
        if (block.chainid != 8453) return;
        _installHook();

        ForkToken token = new ForkToken("Fee B20", "FB20F");
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
        locker.setGraduationManager(graduationManager);
        token.mint(address(locker), 1_000_000_000 ether);
        vm.deal(graduationManager, 10 ether);
        vm.deal(address(this), 1 ether);

        vm.prank(graduationManager);
        bytes32 positionId = locker.lockLiquidity{value: 5 ether}(1, address(token), 1_000_000_000 ether, address(this));
        (,,,,, uint256 tokenId, uint128 liquidityBefore,,,) = locker.lockedPositions(positionId);

        V4SwapRouter.ExactInputSingleParams memory swap = V4SwapRouter.ExactInputSingleParams({
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
        V4SwapRouter(UNIVERSAL_ROUTER).execute{value: 0.1 ether}(hex"10", inputs, block.timestamp + 1 hours);

        locker.collectFees(positionId);
        (uint256 nativeCollected,,,,,) = locker.feeRevenue(positionId);
        assertGt(nativeCollected, 0);
        assertGt(locker.pendingFees(address(this), address(0)), 0);
        assertEq(IUniswapV4PositionManager(POSITION_MANAGER).getPositionLiquidity(tokenId), liquidityBefore);
    }

    function _installHook() private {
        MockPoolInitializationHook template = new MockPoolInitializationHook();
        vm.etch(HOOK, address(template).code);
        MockPoolInitializationHook(HOOK).initialize(POOL_MANAGER);
    }
}

interface V4SwapRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

contract ForkToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
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
        emit Transfer(from, to, amount);
    }
}
