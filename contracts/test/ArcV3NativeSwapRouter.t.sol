// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {ArcV3NativeSwapRouter} from "../src/arc/ArcV3NativeSwapRouter.sol";
import {IArcNativeUSDC, IArcV3Factory, IArcV3SwapRouter} from "../src/arc/ArcV3Interfaces.sol";
import {IStableSwapRouter02} from "../src/stable/StableUniswapV3Interfaces.sol";

contract MockArcNativeUSDC {
    VmArcNative private constant VM =
        VmArcNative(address(uint160(uint256(keccak256("hevm cheat code")))));
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function balanceOf(address account) external view returns (uint256) {
        return account.balance / 1e12;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ALLOWANCE");
        allowance[from][msg.sender] = approved - amount;
        uint256 nativeAmount = amount * 1e12;
        require(from.balance >= nativeAmount, "BALANCE");
        VM.deal(from, from.balance - nativeAmount);
        VM.deal(to, to.balance + nativeAmount);
        return true;
    }
}

interface VmArcNative {
    function deal(address account, uint256 balance) external;
}

contract MockArcV3Factory {
    function feeAmountTickSpacing(uint24 fee) external pure returns (int24) {
        return fee == 10_000 ? int24(200) : int24(0);
    }
}

contract MockArcToken {
    mapping(address => uint256) public balanceOf;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }
}

contract MockArcV3SwapRouter {
    MockArcNativeUSDC public immutable usdc;
    address public immutable factory;
    address public constant POOL = address(0xBEEF);

    constructor(MockArcNativeUSDC usdc_, address factory_) {
        usdc = usdc_;
        factory = factory_;
    }

    function exactInputSingle(IStableSwapRouter02.ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        require(usdc.transferFrom(msg.sender, POOL, params.amountIn), "TRANSFER_FROM");
        amountOut = params.amountIn * 1e18;
        MockArcToken(params.tokenOut).mint(params.recipient, amountOut);
    }
}

contract ArcV3NativeSwapRouterTest is Test {
    MockArcNativeUSDC private usdc;
    MockArcV3Factory private factory;
    MockArcV3SwapRouter private uniswapRouter;
    MockArcToken private token;
    ArcV3NativeSwapRouter private nativeSwapRouter;

    function setUp() public {
        usdc = new MockArcNativeUSDC();
        factory = new MockArcV3Factory();
        uniswapRouter = new MockArcV3SwapRouter(usdc, address(factory));
        token = new MockArcToken();
        nativeSwapRouter = new ArcV3NativeSwapRouter(
            IArcNativeUSDC(address(usdc)),
            IArcV3Factory(address(factory)),
            IArcV3SwapRouter(address(uniswapRouter))
        );
        vm.deal(address(this), 10 ether);
    }

    function testBuyUsesNativeUsdcWithoutUserApproval() public {
        assertEq(usdc.allowance(address(this), address(nativeSwapRouter)), 0);

        uint256 amountOut = nativeSwapRouter.swapExactNativeUsdcForToken{value: 1 ether}(
            address(token),
            10_000,
            address(this),
            1,
            block.timestamp + 20 minutes
        );

        assertGt(amountOut, 0);
        assertEq(token.balanceOf(address(this)), amountOut);
        assertEq(address(nativeSwapRouter).balance, 0);
        assertEq(usdc.balanceOf(address(nativeSwapRouter)), 0);
        assertEq(usdc.allowance(address(nativeSwapRouter), address(uniswapRouter)), 0);
        assertEq(usdc.allowance(address(this), address(nativeSwapRouter)), 0);
    }
}
