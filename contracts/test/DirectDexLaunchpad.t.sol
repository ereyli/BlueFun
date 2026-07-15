// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {
    IERC20Minimal,
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {DirectB20LaunchFactory} from "../src/DirectB20LaunchFactory.sol";
import {DirectLaunchFactoryBase} from "../src/DirectLaunchFactoryBase.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {IB20} from "../src/interfaces/IB20.sol";
import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {MockActivationRegistry} from "./mocks/MockActivationRegistry.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";
import {MockB20Factory} from "./mocks/MockB20Factory.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockPoolInitializationHook} from "./mocks/MockPoolInitializationHook.sol";

contract DirectDexLaunchpadTest is Test {
    uint160 private constant Q96 = 0x1000000000000000000000000;
    address private constant HOOK = address(0x2000);

    address creator = address(0xC0FFEE);
    address platform = address(0xFEE);
    MockDirectPositionManager v4;
    MockDirectPermit2 permit2;
    DirectDexLiquidityLocker locker;
    DirectErc20LaunchFactory factory;

    receive() external payable {}

    function setUp() public {
        v4 = new MockDirectPositionManager();
        permit2 = new MockDirectPermit2();
        MockPoolInitializationHook hookTemplate = new MockPoolInitializationHook();
        vm.etch(HOOK, address(hookTemplate).code);
        MockPoolInitializationHook(HOOK).initialize(address(v4));
        locker = new DirectDexLiquidityLocker(
            address(this),
            platform,
            IUniswapV4PositionManager(address(v4)),
            IUniswapV4StateView(address(v4)),
            IPermit2AllowanceTransfer(address(permit2)),
            IPoolInitializationGuard(HOOK)
        );
        MockPoolInitializationHook(HOOK).allowLocker(address(locker));
        factory = new DirectErc20LaunchFactory(address(this), locker, payable(platform), _config(), 0.002 ether);
        locker.setFactory(address(factory));
        vm.deal(creator, 1 ether);
    }

    function testCreatesOneBillionSupplyAndLocksV4PositionImmediately() public {
        (uint256 launchId, address token,, bytes32 positionId) =
            _createAs(creator, factory, _metadata("Direct", "DEX", "direct"));

        assertEq(launchId, 1);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        (
            uint256 storedLaunchId,
            address storedToken,
            address storedCreator,
            uint256 tokenId,
            uint128 liquidity,,,,,,,,
        ) = locker.lockedPositions(positionId);
        assertEq(storedLaunchId, 1);
        assertEq(storedToken, token);
        assertEq(storedCreator, creator);
        assertEq(tokenId, 1);
        assertGt(liquidity, 0);
        assertEq(factory.pendingLaunchFees(), 0.002 ether);
    }

    function testFeeCollectionKeepsPrincipalAndSplitsSeventyThirty() public {
        (, address token,, bytes32 positionId) = _createAs(creator, factory, _metadata("Fees", "FEE", "fees"));
        (,,, uint256 tokenId, uint128 liquidityBefore,,,,,,,,) = locker.lockedPositions(positionId);

        vm.deal(address(v4), 1 ether);
        v4.queueFees(token, 1 ether, 0);
        locker.collectFees(positionId);

        assertEq(v4.getPositionLiquidity(tokenId), liquidityBefore);
        assertEq(locker.pendingFees(platform, address(0)), 0.7 ether);
        assertEq(locker.pendingFees(creator, address(0)), 0.3 ether);
    }

    function testUnsafeOrExcessiveFutureFeeConfigIsRejected() public {
        DirectDexLiquidityLocker.PoolConfig memory config = _config();
        config.poolFee = 50_001;
        vm.expectRevert(DirectLaunchFactoryBase.InvalidLaunchConfig.selector);
        factory.setLaunchConfig(config);

        config = _config();
        config.platformShareBps = 6_999;
        vm.expectRevert(DirectLaunchFactoryBase.InvalidLaunchConfig.selector);
        factory.setLaunchConfig(config);
    }

    function testCopiedCalldataCannotStealCreatorAttribution() public {
        address attacker = address(0xBAD);
        vm.deal(attacker, 1 ether);
        DirectLaunchFactoryBase.TokenMetadata memory metadata = _metadata("Bound", "BND", "shared-salt");

        address creatorPrediction = factory.predictTokenAddress(creator, metadata);
        address attackerPrediction = factory.predictTokenAddress(attacker, metadata);
        assertTrue(creatorPrediction != attackerPrediction);

        (, address attackerToken,, bytes32 attackerPosition) = _createAs(attacker, factory, metadata);
        (, address creatorToken,, bytes32 creatorPosition) = _createAs(creator, factory, metadata);
        assertEq(attackerToken, attackerPrediction);
        assertEq(creatorToken, creatorPrediction);
        (,, address recordedAttacker,,,,,,,,,,) = locker.lockedPositions(attackerPosition);
        (,, address recordedCreator,,,,,,,,,,) = locker.lockedPositions(creatorPosition);
        assertEq(recordedAttacker, attacker);
        assertEq(recordedCreator, creator);
    }

    function testCreateRevertsWhenCommittedConfigChanges() public {
        DirectLaunchFactoryBase.TokenMetadata memory metadata = _metadata("Committed", "CMT", "commit");
        bytes32 committedHash = factory.launchConfigHash();
        DirectDexLiquidityLocker.PoolConfig memory config = _config();
        config.platformShareBps = 8_000;
        config.creatorShareBps = 2_000;
        factory.setLaunchConfig(config);

        vm.prank(creator);
        vm.expectRevert(DirectLaunchFactoryBase.LaunchConfigChanged.selector);
        factory.createLaunch{value: 0.002 ether}(metadata, committedHash, block.timestamp + 1 hours);
    }

    function testBaseB20DirectLaunchEndsAdminlessWithSupplyInLockedPosition() public {
        MockActivationRegistry activation = new MockActivationRegistry();
        MockPolicyRegistry policy = new MockPolicyRegistry();
        MockB20Factory b20Factory = new MockB20Factory();
        DirectDexLiquidityLocker b20Locker = new DirectDexLiquidityLocker(
            address(this),
            platform,
            IUniswapV4PositionManager(address(v4)),
            IUniswapV4StateView(address(v4)),
            IPermit2AllowanceTransfer(address(permit2)),
            IPoolInitializationGuard(HOOK)
        );
        MockPoolInitializationHook(HOOK).allowLocker(address(b20Locker));
        DirectB20LaunchFactory b20LaunchFactory = new DirectB20LaunchFactory(
            address(this),
            b20Factory,
            IActivationRegistry(address(activation)),
            IPolicyRegistry(address(policy)),
            b20Locker,
            payable(platform),
            _config(),
            0.002 ether
        );
        b20Locker.setFactory(address(b20LaunchFactory));
        activation.setActivated(B20Constants.B20_ASSET_FEATURE, true);

        (, address token,,) = _createAs(creator, b20LaunchFactory, _metadata("Direct B20", "DB20", "direct-b20"));

        assertEq(IB20(token).totalSupply(), 1_000_000_000 ether);
        assertTrue(MockB20(token).adminless());
        assertFalse(IB20(token).hasRole(IB20(token).MINT_ROLE(), address(b20Factory)));
    }

    function testUnauthorizedPoolInitializationCannotCaptureLaunch() public {
        DirectLaunchFactoryBase.TokenMetadata memory metadata = _metadata("Protected", "SAFE", "safe");
        address predicted = factory.predictTokenAddress(creator, metadata);
        IUniswapV4PositionManager.PoolKey memory pool = IUniswapV4PositionManager.PoolKey({
            currency0: address(0), currency1: predicted, fee: 10_000, tickSpacing: 60, hooks: HOOK
        });

        vm.expectRevert();
        v4.initializePool(pool, Q96 + 1);

        (, address token,,) = _createAs(creator, factory, metadata);
        assertEq(token, predicted);
    }

    function _config() internal pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 10_000,
            tickSpacing: 60,
            tickLower: -60,
            tickUpper: 0,
            initialSqrtPriceX96: Q96,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }

    function _createAs(
        address account,
        DirectLaunchFactoryBase launchFactory,
        DirectLaunchFactoryBase.TokenMetadata memory metadata
    ) internal returns (uint256, address, bytes32, bytes32) {
        bytes32 configHash = launchFactory.launchConfigHash();
        vm.prank(account);
        return launchFactory.createLaunch{value: 0.002 ether}(metadata, configHash, block.timestamp + 1 hours);
    }

    function _metadata(string memory name, string memory symbol, string memory salt)
        internal
        pure
        returns (DirectLaunchFactoryBase.TokenMetadata memory)
    {
        return DirectLaunchFactoryBase.TokenMetadata({
            name: name, symbol: symbol, contractURI: "ipfs://metadata", salt: keccak256(bytes(salt))
        });
    }
}

contract MockDirectPositionManager is IUniswapV4PositionManager, IUniswapV4StateView {
    mapping(bytes32 poolId => uint160 sqrtPriceX96) public sqrtPrices;
    mapping(uint256 tokenId => uint128 liquidity) public positionLiquidity;
    uint256 public next = 1;
    address public feeToken;
    uint256 public nativeFees;
    uint256 public tokenFees;

    receive() external payable {}

    function setInitialized(address token, uint24 fee, uint160 sqrtPriceX96) external {
        PoolKey memory pool =
            PoolKey({currency0: address(0), currency1: token, fee: fee, tickSpacing: 60, hooks: address(0)});
        sqrtPrices[keccak256(abi.encode(pool))] = sqrtPriceX96;
    }

    function queueFees(address token, uint256 nativeAmount, uint256 tokenAmount) external {
        feeToken = token;
        nativeFees = nativeAmount;
        tokenFees = tokenAmount;
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
        bytes32 poolId = keccak256(abi.encode(key));
        require(sqrtPrices[poolId] == 0, "initialized");
        if (key.hooks != address(0)) {
            (bool ok,) = key.hooks
                .call(
                    abi.encodeWithSignature(
                        "beforeInitialize(address,(address,address,uint24,int24,address),uint160)",
                        msg.sender,
                        key,
                        sqrtPriceX96
                    )
                );
            require(ok, "hook");
        }
        sqrtPrices[poolId] = sqrtPriceX96;
        return key.tickSpacing == 0 ? int24(0) : int24(0);
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
            if (tokenAmount > 0) IERC20Minimal(feeToken).transfer(recipient, tokenAmount);
            return;
        }
        positionLiquidity[next] = 1;
        next++;
    }

    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        sqrtPriceX96 = sqrtPrices[poolId];
        tick = 0;
        protocolFee = 0;
        lpFee = 0;
    }
}

contract MockDirectPermit2 is IPermit2AllowanceTransfer {
    function approve(address, address, uint160, uint48) external {}
}
