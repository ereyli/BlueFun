// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";
import {FullMath} from "../src/libraries/FullMath.sol";

contract UniswapV4LiquidityLockerTest is Test {
    address owner = address(this);
    address graduationManager = address(0xDAD);
    address platform = address(0xFEE);
    address creator = address(0xC0FFEE);
    MockV4PositionManagerAndStateView v4;
    MockPermit2 permit2;
    MockERC20 token;
    UniswapV4LiquidityLocker locker;

    function setUp() public {
        v4 = new MockV4PositionManagerAndStateView();
        permit2 = new MockPermit2();
        token = new MockERC20();
        locker = new UniswapV4LiquidityLocker(
            owner,
            platform,
            IUniswapV4PositionManager(address(v4)),
            IUniswapV4StateView(address(v4)),
            IPermit2AllowanceTransfer(address(permit2)),
            3_000,
            60,
            address(0)
        );
        locker.setGraduationManager(graduationManager);
        token.mint(address(locker), 1_000_000_000 ether);
        vm.deal(graduationManager, 20 ether);
    }

    function testUsesFallbackFeeWhenPrimaryPoolWasInitializedAtBadPrice() public {
        uint160 expectedPrice = lockerPreviewSqrtPrice(1_000_000_000 ether, 5 ether);
        uint160 badPrice = uint160((uint256(expectedPrice) * 2) / 1);
        v4.setInitialized(address(token), 3_000, badPrice);

        vm.prank(graduationManager);
        bytes32 positionId = locker.lockLiquidity{value: 5 ether}(1, address(token), 1_000_000_000 ether, creator);

        (,,,,,,,, uint24 usedFee,) = locker.lockedPositions(positionId);
        assertEq(usedFee, 10_000);
    }

    function testRevertsWhenAllCandidatePoolsHaveUnsafePrices() public {
        uint160 expectedPrice = lockerPreviewSqrtPrice(1_000_000_000 ether, 5 ether);
        uint160 badPrice = uint160((uint256(expectedPrice) * 2) / 1);
        v4.setInitialized(address(token), 3_000, badPrice);
        v4.setInitialized(address(token), 10_000, badPrice);
        v4.setInitialized(address(token), 500, badPrice);
        v4.setInitialized(address(token), 100, badPrice);

        vm.prank(graduationManager);
        vm.expectRevert(UniswapV4LiquidityLocker.NoUsablePool.selector);
        locker.lockLiquidity{value: 5 ether}(1, address(token), 1_000_000_000 ether, creator);
    }

    function testCollectsAndSplitsFeesWithoutChangingLiquidity() public {
        vm.prank(graduationManager);
        bytes32 positionId = locker.lockLiquidity{value: 5 ether}(1, address(token), 1_000_000_000 ether, creator);
        (,,,,, uint256 tokenId, uint128 liquidityBefore,,,) = locker.lockedPositions(positionId);

        vm.deal(address(v4), 1 ether);
        token.mint(address(v4), 100 ether);
        v4.queueFees(address(token), 1 ether, 100 ether);

        locker.collectFees(positionId);

        assertEq(v4.getPositionLiquidity(tokenId), liquidityBefore);
        assertEq(locker.pendingFees(platform, address(0)), 0.7 ether);
        assertEq(locker.pendingFees(creator, address(0)), 0.3 ether);
        assertEq(locker.pendingFees(platform, address(token)), 70 ether);
        assertEq(locker.pendingFees(creator, address(token)), 30 ether);

        vm.prank(creator);
        locker.claimFees(address(0));
        assertEq(creator.balance, 0.3 ether);

        vm.prank(creator);
        locker.claimFees(address(token));
        assertEq(token.balanceOf(creator), 30 ether);
    }

    function lockerPreviewSqrtPrice(uint256 tokenAmount, uint256 ethAmount) internal pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(tokenAmount, 2 ** 192, ethAmount);
        return uint160(sqrt(ratioX192));
    }

    function sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }
}

contract MockV4PositionManagerAndStateView is IUniswapV4PositionManager, IUniswapV4StateView {
    mapping(bytes32 poolId => uint160 sqrtPriceX96) public sqrtPrices;
    mapping(uint256 tokenId => uint128 liquidity) public positionLiquidity;
    uint256 public next = 1;
    address public feeToken;
    uint256 public nativeFees;
    uint256 public tokenFees;

    receive() external payable {}

    function queueFees(address token, uint256 nativeAmount, uint256 tokenAmount) external {
        feeToken = token;
        nativeFees = nativeAmount;
        tokenFees = tokenAmount;
    }

    function setInitialized(address token, uint24 fee, uint160 sqrtPriceX96) external {
        PoolKey memory pool =
            PoolKey({currency0: address(0), currency1: token, fee: fee, tickSpacing: 60, hooks: address(0)});
        sqrtPrices[poolId(pool)] = sqrtPriceX96;
    }

    function multicall(bytes[] calldata) external payable returns (bytes[] memory results) {
        results = new bytes[](0);
    }

    function nextTokenId() external view returns (uint256) {
        return next;
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity) {
        return positionLiquidity[tokenId];
    }

    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24) {
        bytes32 id = poolId(key);
        if (sqrtPrices[id] != 0) revert("initialized");
        sqrtPrices[id] = sqrtPriceX96;
        return 0;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        if (uint8(actions[0]) == 0x01) {
            (address currency0, address currency1, address recipient) =
                abi.decode(params[1], (address, address, address));
            require(currency0 == address(0) && currency1 == feeToken, "currencies");
            uint256 nativeAmount = nativeFees;
            uint256 tokenAmount = tokenFees;
            nativeFees = 0;
            tokenFees = 0;
            if (nativeAmount > 0) payable(recipient).transfer(nativeAmount);
            if (tokenAmount > 0) MockERC20(feeToken).transfer(recipient, tokenAmount);
            return;
        }
        positionLiquidity[next] = 1;
        next++;
    }

    function getSlot0(bytes32 id)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        sqrtPriceX96 = sqrtPrices[id];
        tick = 0;
        protocolFee = 0;
        lpFee = 0;
    }

    function poolId(PoolKey memory key) public pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}

contract MockPermit2 is IPermit2AllowanceTransfer {
    function approve(address, address, uint160, uint48) external {}
}

contract MockERC20 {
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
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
