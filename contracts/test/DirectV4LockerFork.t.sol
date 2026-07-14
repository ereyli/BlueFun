// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";
import {DirectDexLiquidityLocker} from "../src/DirectDexLiquidityLocker.sol";

contract DirectV4LockerForkTest is Test {
    address internal constant BASE_POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant BASE_STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant BASE_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address internal constant ROBINHOOD_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant ROBINHOOD_STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant ROBINHOOD_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function testForkCreatesTokenOnlyCurveAndCollectsOnePercentFees() public {
        if (block.chainid != 8453 && block.chainid != 4663) return;

        address positionManager = block.chainid == 8453 ? BASE_POSITION_MANAGER : ROBINHOOD_POSITION_MANAGER;
        address stateView = block.chainid == 8453 ? BASE_STATE_VIEW : ROBINHOOD_STATE_VIEW;
        address router = block.chainid == 8453 ? BASE_ROUTER : ROBINHOOD_ROUTER;
        DirectForkToken token = new DirectForkToken();
        DirectDexLiquidityLocker locker = new DirectDexLiquidityLocker(
            address(this),
            address(0xFEE),
            IUniswapV4PositionManager(positionManager),
            IUniswapV4StateView(stateView),
            IPermit2AllowanceTransfer(PERMIT2)
        );
        locker.setFactory(address(this));
        token.mint(address(locker), 1_000_000_000 ether);

        (bytes32 positionId,) =
            locker.lockTokenOnlyLiquidity(1, address(token), 1_000_000_000 ether, address(this), _config());
        (,,, uint256 tokenId, uint128 liquidityBefore,,,,,,,,) = locker.lockedPositions(positionId);
        assertGt(tokenId, 0);
        assertGt(liquidityBefore, 0);

        vm.deal(address(this), 1 ether);
        DirectV4SwapRouter.ExactInputSingleParams memory swap = DirectV4SwapRouter.ExactInputSingleParams({
            poolKey: IUniswapV4PositionManager.PoolKey({
                currency0: address(0), currency1: address(token), fee: 10_000, tickSpacing: 200, hooks: address(0)
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
        DirectV4SwapRouter(router).execute{value: 0.1 ether}(hex"10", inputs, block.timestamp + 1 hours);

        assertGt(token.balanceOf(address(this)), 0);
        locker.collectFees(positionId);
        (uint256 nativeCollected,,,,,) = locker.feeRevenue(positionId);
        assertGt(nativeCollected, 0);
        assertEq(IUniswapV4PositionManager(positionManager).getPositionLiquidity(tokenId), liquidityBefore);
    }

    function _config() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 10_000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            sqrtPriceLowerX96: 269_413_644,
            sqrtPriceUpperX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }
}

interface DirectV4SwapRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

contract DirectForkToken {
    string public constant name = "Direct Fork";
    string public constant symbol = "DFORK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
