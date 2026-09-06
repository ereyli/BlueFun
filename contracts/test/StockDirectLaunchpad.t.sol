// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {StockQuoteRegistry, IPausableStockOracle} from "../src/stock/StockQuoteRegistry.sol";
import {StockLiquidityLocker, IStockPoolInitializationGuard} from "../src/stock/StockLiquidityLocker.sol";
import {StockDirectErc20LaunchFactory} from "../src/stock/StockDirectErc20LaunchFactory.sol";
import {StockDirectLaunchFactoryBase} from "../src/stock/StockDirectLaunchFactoryBase.sol";
import {StockFeeHook} from "../src/stock/StockFeeHook.sol";
import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {TickMath} from "../src/libraries/TickMath.sol";
import {MockVNextPolicyRouter} from "./mocks/MockVNextPolicyRouter.sol";

contract StockDirectLaunchpadTest is Test {
    address private constant HOOK = address(0x20CC);
    address private constant CREATOR = address(0xC0FFEE);
    uint256 private constant PRICE_SIGNER_KEY = 0xA11CE;

    MockStockPositionManager private manager;
    MockStockPermit2 private permit2;
    MockStockToken private quote;
    MockStockFeed private feed;
    StockQuoteRegistry private registry;
    StockLiquidityLocker private locker;
    StockDirectErc20LaunchFactory private factory;
    MockVNextPolicyRouter private policy;

    function setUp() public {
        manager = new MockStockPositionManager();
        permit2 = new MockStockPermit2();
        quote = new MockStockToken("AAPLc", "AAPLc");
        feed = new MockStockFeed(8, 220e8);
        registry = new StockQuoteRegistry(address(this), vm.addr(PRICE_SIGNER_KEY));
        registry.configureAsset(address(quote), address(feed), bytes32("AAPLc"), 4 days, 18, true, false, false, true);

        MockStockHook hookTemplate = new MockStockHook();
        vm.etch(HOOK, address(hookTemplate).code);
        locker = new StockLiquidityLocker(
            address(this),
            IUniswapV4PositionManager(address(manager)),
            IUniswapV4StateView(address(manager)),
            IPermit2AllowanceTransfer(address(permit2)),
            IStockPoolInitializationGuard(HOOK)
        );
        policy = new MockVNextPolicyRouter();
        policy.setLaunchFee(0.001 ether);
        factory = new StockDirectErc20LaunchFactory(
            address(this),
            locker,
            registry,
            policy,
            policy,
            permit2,
            StockDirectLaunchFactoryBase.LaunchConfig({
                tickSpacing: 60, rangeWidthTicks: 120_000, targetFdvUsd18: 3_000 ether
            })
        );
        locker.setFactory(address(factory));
        vm.deal(CREATOR, 1 ether);
    }

    function testCreatesFixedSupplyStockQuotedLockedPool() public {
        StockDirectLaunchFactoryBase.TokenMetadata memory metadata = _metadata("Apple Frog", "AFROG");
        uint256 price = registry.validatedPrice18(address(quote));
        vm.prank(CREATOR);
        (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) = factory.createLaunch{
            value: 0.001 ether
        }(
            metadata,
            address(quote),
            factory.launchConfigHash(),
            price * 99 / 100,
            price * 101 / 100,
            StockDirectLaunchFactoryBase.PriceProof({attestedPrice18: 0, validUntil: 0, signature: bytes("")}),
            block.timestamp + 1 hours
        );
        assertEq(launchId, 1);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        assertGt(uint256(poolId), 0);
        (uint256 storedLaunchId, address storedToken, address storedQuote,, uint256 tokenId, uint128 liquidity,,,,,) =
            locker.lockedPositions(positionId);
        assertEq(storedLaunchId, 1);
        assertEq(storedToken, token);
        assertEq(storedQuote, address(quote));
        assertEq(tokenId, 1);
        assertGt(liquidity, 0);
        assertEq(policy.launchRevenue(), 0.001 ether);
    }

    function testRejectsDisabledStalePausedAndUnregisteredQuotes() public {
        vm.warp(10 days);
        feed.setUpdatedAt(block.timestamp - 5 days);
        vm.expectRevert(StockQuoteRegistry.StaleOracleAnswer.selector);
        registry.validatedPrice18(address(quote));

        feed.setUpdatedAt(block.timestamp);
        quote.setPaused(true);
        vm.expectRevert(StockQuoteRegistry.OraclePaused.selector);
        registry.validatedPrice18(address(quote));

        quote.setPaused(false);
        registry.disableAsset(address(quote));
        vm.expectRevert(StockQuoteRegistry.InvalidAsset.selector);
        registry.validatedPrice18(address(quote));

        vm.expectRevert(StockQuoteRegistry.InvalidAsset.selector);
        registry.validatedPrice18(address(0xBAD));
    }

    function testTickInverseRoundTripsLaunchRange() public pure {
        int24[7] memory ticks = [int24(-800_000), -120_000, -60, 0, 60, 120_000, 800_000];
        for (uint256 i; i < ticks.length; ++i) {
            uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(ticks[i]);
            assertTrue(TickMath.getTickAtSqrtPrice(sqrtPrice) == ticks[i]);
        }
    }

    function testOfficialNoFeedAssetUsesShortLivedBoundAttestation() public {
        MockStockToken noFeed = new MockStockToken("Adobe", "ADBE");
        registry.configureAsset(address(noFeed), address(0), bytes32("ADBE"), 4 days, 18, false, false, true, true);
        uint64 validUntil = uint64(block.timestamp + 2 minutes);
        uint256 price = 350 ether;
        bytes32 payload = keccak256(
            abi.encode(
                "BLUEFUN_STOCK_OPENING_PRICE_V1", block.chainid, address(registry), address(noFeed), price, validUntil
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payload));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PRICE_SIGNER_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        assertEq(registry.validatedPrice18(address(noFeed), price, validUntil, signature), price);

        vm.expectRevert(StockQuoteRegistry.InvalidPriceProof.selector);
        registry.validatedPrice18(address(noFeed), price + 1, validUntil, signature);
    }

    function _metadata(string memory name, string memory symbol)
        private
        pure
        returns (StockDirectLaunchFactoryBase.TokenMetadata memory)
    {
        return StockDirectLaunchFactoryBase.TokenMetadata({
            name: name, symbol: symbol, contractURI: "ipfs://stock-launch", salt: keccak256(bytes(name))
        });
    }
}

contract MockStockFeed is IPausableStockOracle {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    bool public oraclePaused;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 value) external {
        updatedAt = value;
    }

    function setPaused(bool value) external {
        oraclePaused = value;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract MockStockToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public oraclePaused;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function setPaused(bool value) external {
        oraclePaused = value;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
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

contract MockStockHook {
    mapping(bytes32 => uint160) public prices;

    function authorizePool(bytes32 poolId, uint160 sqrtPriceX96, address, address, address) external {
        prices[poolId] = sqrtPriceX96;
    }
}

contract MockStockPositionManager is IUniswapV4PositionManager, IUniswapV4StateView {
    mapping(bytes32 => uint160) private prices;
    mapping(uint256 => uint128) private liquidities;
    uint256 private next = 1;

    function multicall(bytes[] calldata) external payable returns (bytes[] memory results) {
        return new bytes[](0);
    }

    function nextTokenId() external view returns (uint256) {
        return next;
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return liquidities[tokenId];
    }

    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24) {
        bytes32 id = keccak256(abi.encode(key));
        require(prices[id] == 0, "initialized");
        prices[id] = sqrtPriceX96;
        return 0;
    }

    function modifyLiquidities(bytes calldata, uint256) external payable {
        liquidities[next++] = 1;
    }

    function getSlot0(bytes32 poolId) external view returns (uint160, int24, uint24, uint24) {
        return (prices[poolId], 0, 0, 0);
    }
}

contract MockStockPermit2 is IPermit2AllowanceTransfer {
    function approve(address, address, uint160, uint48) external {}
}

contract StockFeeHookDirectionTest is Test {
    address private constant CREATOR_ACCOUNT = address(0xC0FFEE);
    address private constant PLATFORM_ACCOUNT = address(0xB10E);

    MockVNextPolicyRouter private policy;
    MockStockFeePoolManager private poolManager;
    StockFeeHook private hook;
    MockStockToken private token;
    MockStockToken private quote;

    function setUp() public {
        policy = new MockVNextPolicyRouter();
        poolManager = new MockStockFeePoolManager();
        hook = _deployFlaggedHook();
        address[] memory lockers = new address[](1);
        lockers[0] = address(this);
        hook.configureLockers(lockers);
        token = new MockStockToken("Meme", "MEME");
        quote = new MockStockToken("Stock", "STOCK");
    }

    function testFeesFollowQuoteAndMemeRegardlessOfAddressOrdering() public {
        StockFeeHook.PoolKey memory key = StockFeeHook.PoolKey({
            currency0: address(token) < address(quote) ? address(token) : address(quote),
            currency1: address(token) < address(quote) ? address(quote) : address(token),
            fee: hook.DYNAMIC_FEE_FLAG(),
            tickSpacing: 60,
            hooks: address(hook)
        });
        bytes32 poolId = keccak256(abi.encode(key));
        hook.authorizePool(poolId, 1, address(token), address(quote), CREATOR_ACCOUNT);

        bool quoteIsCurrency0 = address(quote) == key.currency0;
        StockFeeHook.SwapParams memory buy =
            StockFeeHook.SwapParams({zeroForOne: quoteIsCurrency0, amountSpecified: -10_000, sqrtPriceLimitX96: 0});
        poolManager.callBeforeSwap(hook, key, buy);
        assertEq(hook.pendingRevenue(PLATFORM_ACCOUNT, address(quote)), 70);
        assertEq(hook.pendingRevenue(CREATOR_ACCOUNT, address(quote)), 30);

        StockFeeHook.SwapParams memory sell =
            StockFeeHook.SwapParams({zeroForOne: !quoteIsCurrency0, amountSpecified: -10_000, sqrtPriceLimitX96: 0});
        poolManager.callBeforeSwap(hook, key, sell);
        int256 quoteOutputDelta = sell.zeroForOne ? int256(10_000) : int256(10_000) << 128;
        poolManager.callAfterSwap(hook, key, sell, quoteOutputDelta);
        assertEq(hook.pendingRevenue(PLATFORM_ACCOUNT, address(quote)), 140);
        assertEq(poolManager.taken(address(token), hook.DEAD_WALLET()), 30);
    }

    function _deployFlaggedHook() private returns (StockFeeHook deployed) {
        bytes memory initCode = abi.encodePacked(
            type(StockFeeHook).creationCode,
            abi.encode(address(this), address(poolManager), PLATFORM_ACCOUNT, policy)
        );
        bytes32 hash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash))))
            );
            if ((uint160(predicted) & hookFlagMask()) == hookRequiredFlags()) break;
        }
        deployed = new StockFeeHook{salt: salt}(address(this), address(poolManager), PLATFORM_ACCOUNT, policy);
        assertEq(address(deployed), predicted);
    }

    function hookFlagMask() private pure returns (uint160) {
        return (1 << 14) - 1;
    }

    function hookRequiredFlags() private pure returns (uint160) {
        return (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);
    }
}

contract MockStockFeePoolManager {
    mapping(address => mapping(address => uint256)) public taken;

    function take(address currency, address to, uint256 amount) external {
        taken[currency][to] += amount;
    }

    function callBeforeSwap(
        StockFeeHook hook,
        StockFeeHook.PoolKey calldata key,
        StockFeeHook.SwapParams calldata params
    ) external {
        hook.beforeSwap(address(this), key, params, bytes(""));
    }

    function callAfterSwap(
        StockFeeHook hook,
        StockFeeHook.PoolKey calldata key,
        StockFeeHook.SwapParams calldata params,
        int256 delta
    ) external {
        hook.afterSwap(address(this), key, params, delta, bytes(""));
    }
}
