// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {IERC20Minimal} from "../src/UniswapV4LiquidityLocker.sol";
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

interface IERC20TransferFrom {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract StableV3DirectLaunchpadTest is Test {
    address private constant CREATOR = address(0xCAFE);
    address private constant SAFE = address(0x5AFE);
    address private constant GUARDIAN = address(0xB0B);
    uint256 private constant LAUNCH_FEE = 0.001 ether;

    MockStableUSDT0 private usdt0;
    MockStableV3Factory private uniswapFactory;
    MockStablePositionManager private positionManager;
    MockStableSwapRouter private swapRouter;
    StableFeePolicy private policy;
    StableRevenueRouter private revenueRouter;
    StableV3LiquidityLocker private locker;
    StableV3DirectLaunchFactory private launchFactory;

    function setUp() public {
        usdt0 = new MockStableUSDT0();
        uniswapFactory = new MockStableV3Factory();
        positionManager = new MockStablePositionManager(uniswapFactory);
        swapRouter = new MockStableSwapRouter(positionManager);
        policy = new StableFeePolicy(address(this), GUARDIAN, LAUNCH_FEE);
        revenueRouter = new StableRevenueRouter(address(this), SAFE);
        locker = new StableV3LiquidityLocker(
            address(this),
            address(usdt0),
            SAFE,
            uniswapFactory,
            positionManager,
            StableV3LiquidityLocker.CurveConfig({
                canonicalTickLower: -572_600,
                canonicalTickUpper: 400_600,
                canonicalInitialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630_000_000
            })
        );
        launchFactory = new StableV3DirectLaunchFactory(
            address(this), locker, policy, revenueRouter, IStableUSDT0(address(usdt0)), swapRouter
        );
        locker.setFactory(address(launchFactory));
        vm.deal(CREATOR, 100 ether);
    }

    function testDirectLaunchCreatesTokenOnlyPermanentV3Position() public {
        (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) = _launch(0, 0);
        assertEq(launchId, 1);
        assertTrue(token != address(0));
        assertTrue(poolId != bytes32(0));
        assertTrue(positionId != bytes32(0));
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        assertEq(StandardLaunchToken(token).balanceOf(address(locker)), 0);
        assertEq(revenueRouter.pendingTreasuryRevenue(), LAUNCH_FEE);

        (
            uint256 storedLaunchId,
            address storedToken,
            address storedCreator,
            address pool,
            uint256 tokenId,
            uint128 liquidity,
            uint256 tokenAmountLocked,
            ,
            ,
        ) = locker.lockedPositions(positionId);
        assertEq(storedLaunchId, launchId);
        assertEq(storedToken, token);
        assertEq(storedCreator, CREATOR);
        assertTrue(pool != address(0));
        assertEq(tokenId, uint256(positionId));
        assertGt(liquidity, 0);
        assertEq(tokenAmountLocked, 1_000_000_000 ether);
        assertEq(positionManager.ownerOf(tokenId), address(locker));
    }

    function testBuyQuoteFeesSplitSeventyThirtyAndSellTokenFeeBurnsThirtyPercent() public {
        (, address token,, bytes32 positionId) = _launch(0, 0);
        uint256 quoteFees = 1_000_000; // 1 USDT0 using the ERC-20 6-decimal interface.
        uint256 tokenFees = 100 ether;
        usdt0.mint(address(positionManager), quoteFees);
        positionManager.seedFees(uint256(positionId), quoteFees, tokenFees, address(usdt0), token);

        locker.collectFees(positionId);
        assertEq(locker.pendingFees(SAFE, address(usdt0)), 700_000);
        assertEq(locker.pendingFees(CREATOR, address(usdt0)), 300_000);
        assertEq(locker.pendingFees(SAFE, token), 70 ether);
        assertEq(StandardLaunchToken(token).balanceOf(address(0xdead)), 30 ether);
        assertEq(locker.pendingFees(CREATOR, token), 0);

        vm.prank(CREATOR);
        locker.claimFees(address(usdt0));
        assertEq(usdt0.balanceOf(CREATOR), 300_000);
        locker.sweepPlatformFees(address(usdt0));
        locker.sweepPlatformFees(token);
        assertEq(usdt0.balanceOf(SAFE), 700_000);
        assertEq(StandardLaunchToken(token).balanceOf(SAFE), 70 ether);
    }

    function testCreatorInitialBuyUsesSixDecimalUSDT0AmountAndFivePercentCap() public {
        swapRouter.setAmountOut(10_000_000 ether);
        (, address token,,) = _launch(1 ether, 1);
        assertEq(StandardLaunchToken(token).balanceOf(CREATOR), 10_000_000 ether);
        assertEq(swapRouter.lastAmountIn(), 1_000_000);
        assertEq(swapRouter.lastRecipient(), CREATOR);
    }

    function testInitialBuyRejectsZeroERC20Amount() public {
        StableV3DirectLaunchFactory.TokenMetadata memory metadata = _metadata(bytes32("zero-buy"));
        bytes32 configHash = launchFactory.launchConfigHash();
        vm.prank(CREATOR);
        vm.expectRevert(StableV3DirectLaunchFactory.InitialBuyFailed.selector);
        launchFactory.createLaunchWithInitialBuy{value: LAUNCH_FEE}(
            metadata, configHash, block.timestamp + 1 hours, 0, 0
        );
    }

    function testOnlyFactoryCanMintAndFactoryCannotBeReconfigured() public {
        vm.expectRevert(StableV3LiquidityLocker.NotFactory.selector);
        locker.lockTokenOnlyLiquidity(1, address(usdt0), 1, CREATOR);

        vm.expectRevert(StableV3LiquidityLocker.AlreadyConfigured.selector);
        locker.setFactory(address(0x1234));
    }

    function testStableFeeRatiosCannotBeChanged() public {
        vm.expectRevert(StableFeePolicy.InvalidFee.selector);
        policy.setTradeFees(60, 40, 70, 30);
        policy.setTradeFees(70, 30, 70, 30);
    }

    function testRevenueRouterChecksRealNativeSolvencyBeforeClaim() public {
        vm.deal(address(this), 1 ether);
        revenueRouter.depositLaunchRevenue{value: 1 ether}();
        vm.deal(address(revenueRouter), 0);
        vm.expectRevert(StableRevenueRouter.Insolvent.selector);
        revenueRouter.claimTreasuryRevenue();
        assertEq(revenueRouter.pendingTreasuryRevenue(), 1 ether);
    }

    function _launch(uint256 initialBuyNative, uint256 minimumTokensOut)
        private
        returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId)
    {
        StableV3DirectLaunchFactory.TokenMetadata memory metadata =
            _metadata(keccak256(abi.encode(initialBuyNative, minimumTokensOut, block.timestamp)));
        bytes32 configHash = launchFactory.launchConfigHash();
        vm.prank(CREATOR);
        if (initialBuyNative == 0) {
            return launchFactory.createLaunch{value: LAUNCH_FEE}(
                metadata, configHash, block.timestamp + 1 hours
            );
        }
        uint256 initialBuyUSDT0 = initialBuyNative / 1e12;
        usdt0.mint(CREATOR, initialBuyUSDT0);
        vm.prank(CREATOR);
        usdt0.approve(address(launchFactory), initialBuyUSDT0);
        vm.prank(CREATOR);
        return launchFactory.createLaunchWithInitialBuy{value: LAUNCH_FEE}(
            metadata, configHash, block.timestamp + 1 hours, initialBuyUSDT0, minimumTokensOut
        );
    }

    function _metadata(bytes32 salt)
        private
        pure
        returns (StableV3DirectLaunchFactory.TokenMetadata memory metadata)
    {
        metadata = StableV3DirectLaunchFactory.TokenMetadata({
            name: "Stable Direct Token",
            symbol: "SDT",
            contractURI: "ipfs://stable-direct",
            salt: salt
        });
    }
}

contract MockStableUSDT0 is IERC20Minimal {
    string public constant name = "USDT0";
    string public constant symbol = "USDT0";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockStableV3Pool is IStableUniswapV3Pool {
    uint160 private immutable price;

    constructor(uint160 price_) {
        price = price_;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (price, 0, 0, 0, 0, 0, true);
    }
}

contract MockStableV3Factory is IStableUniswapV3Factory {
    mapping(bytes32 => address) private pools;

    function setPool(address token0, address token1, uint24 fee, address pool) external {
        pools[keccak256(abi.encode(token0, token1, fee))] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return pools[keccak256(abi.encode(token0, token1, fee))];
    }
}

contract MockStablePositionManager is IStableNonfungiblePositionManager {
    struct StoredPosition {
        address owner;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 owed0;
        uint128 owed1;
    }

    MockStableV3Factory private immutable factory;
    uint256 private nextTokenId = 1;
    mapping(uint256 => StoredPosition) private stored;

    constructor(MockStableV3Factory factory_) {
        factory = factory_;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool)
    {
        pool = factory.getPool(token0, token1, fee);
        if (pool == address(0)) {
            pool = address(new MockStableV3Pool(sqrtPriceX96));
            factory.setPool(token0, token1, fee, pool);
        }
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = nextTokenId++;
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        if (amount0 != 0) IERC20TransferFrom(params.token0).transferFrom(msg.sender, address(this), amount0);
        if (amount1 != 0) IERC20TransferFrom(params.token1).transferFrom(msg.sender, address(this), amount1);
        liquidity = uint128((amount0 + amount1) / 1e9);
        stored[tokenId] = StoredPosition(
            params.recipient,
            params.token0,
            params.token1,
            params.fee,
            params.tickLower,
            params.tickUpper,
            liquidity,
            0,
            0
        );
        (bool ok, bytes memory data) = params.recipient.call(
            abi.encodeWithSignature(
                "onERC721Received(address,address,uint256,bytes)", msg.sender, address(0), tokenId, bytes("")
            )
        );
        require(ok && abi.decode(data, (bytes4)) == bytes4(keccak256("onERC721Received(address,address,uint256,bytes)")));
    }

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1) {
        StoredPosition storage position = stored[params.tokenId];
        require(position.owner == msg.sender, "not owner");
        amount0 = position.owed0;
        amount1 = position.owed1;
        position.owed0 = 0;
        position.owed1 = 0;
        if (amount0 != 0) IERC20Minimal(position.token0).transfer(params.recipient, amount0);
        if (amount1 != 0) IERC20Minimal(position.token1).transfer(params.recipient, amount1);
    }

    function positions(uint256 tokenId)
        external
        view
        returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)
    {
        StoredPosition storage position = stored[tokenId];
        return (
            0,
            address(0),
            position.token0,
            position.token1,
            position.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            0,
            0,
            position.owed0,
            position.owed1
        );
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return stored[tokenId].owner;
    }

    function seedFees(
        uint256 tokenId,
        uint256 quoteFees,
        uint256 tokenFees,
        address quote,
        address token
    ) external {
        StoredPosition storage position = stored[tokenId];
        bool quoteIsToken0 = quote < token;
        position.owed0 = uint128(quoteIsToken0 ? quoteFees : tokenFees);
        position.owed1 = uint128(quoteIsToken0 ? tokenFees : quoteFees);
    }

    function mockSwap(address token, address recipient, uint256 amount) external {
        IERC20Minimal(token).transfer(recipient, amount);
    }
}

contract MockStableSwapRouter is IStableSwapRouter02 {
    MockStablePositionManager private immutable positionManager;
    uint256 private amountOut;
    uint256 public lastAmountIn;
    address public lastRecipient;

    constructor(MockStablePositionManager positionManager_) {
        positionManager = positionManager_;
    }

    function setAmountOut(uint256 value) external {
        amountOut = value;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256) {
        lastAmountIn = params.amountIn;
        lastRecipient = params.recipient;
        positionManager.mockSwap(params.tokenOut, params.recipient, amountOut);
        return amountOut;
    }
}
