// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {GraduationManager} from "../src/GraduationManager.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {IB20} from "../src/interfaces/IB20.sol";
import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {MockActivationRegistry} from "./mocks/MockActivationRegistry.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";
import {MockB20Factory} from "./mocks/MockB20Factory.sol";
import {MockLiquidityLocker} from "./mocks/MockLiquidityLocker.sol";
import {ProtocolLiquidityLocker} from "../src/ProtocolLiquidityLocker.sol";

contract FairCurveLaunchpadTest is Test {
    address creator = address(0xC0FFEE);
    address buyer = address(0xB0B);
    address seller = address(0x51E11);
    address feeRecipient = address(0xFEE);
    uint256 launchFee = 0.002 ether;

    MockActivationRegistry activation;
    MockPolicyRegistry policy;
    MockB20Factory b20Factory;
    MockLiquidityLocker locker;
    BondingCurveMarket market;
    GraduationManager graduation;
    LaunchFactory factory;

    receive() external payable {}

    function setUp() public {
        activation = new MockActivationRegistry();
        policy = new MockPolicyRegistry();
        b20Factory = new MockB20Factory();
        locker = new MockLiquidityLocker();
        market = new BondingCurveMarket(address(this), feeRecipient);
        graduation = new GraduationManager(market, locker, IPolicyRegistry(address(policy)));
        factory = new LaunchFactory(
            address(this),
            b20Factory,
            IActivationRegistry(address(activation)),
            IPolicyRegistry(address(policy)),
            market,
            address(graduation),
            payable(feeRecipient)
        );
        market.configure(address(factory), address(graduation), feeRecipient);
        activation.setActivated(B20Constants.B20_ASSET_FEATURE, true);

        vm.deal(creator, 10 ether);
        vm.deal(buyer, 10 ether);
        vm.deal(seller, 10 ether);
    }

    function testActivationGateBlocksLaunches() public {
        activation.setActivated(B20Constants.B20_ASSET_FEATURE, false);
        vm.prank(creator);
        vm.expectRevert(LaunchFactory.B20AssetNotActivated.selector);
        factory.createLaunch{value: launchFee}(_metadata("Gated", "GATE", "ipfs://gated", "gated"), _curve(10 ether), _config());
    }

    function testCreateLaunchAndBuy() public {
        (uint256 launchId, address token) = _createLaunch("Buyable", "BUY", 10 ether);
        (,,,,,, uint256 graduationTarget,,,,,,,,,,) = market.launches(launchId);
        assertEq(graduationTarget, factory.GRADUATION_ETH_TARGET());

        uint256 quote;
        (quote,) = market.quoteBuy(launchId, 1 ether);
        assertGt(quote, 0);

        vm.prank(buyer);
        market.buy{value: 1 ether}(launchId, quote - 1, block.timestamp + 1 hours);

        assertEq(IB20(token).balanceOf(buyer), quote);
        assertGt(market.pendingFees(feeRecipient), 0);
        assertGt(market.pendingFees(creator), 0);
    }

    function testCreatorCanInitialBuyDuringLaunch() public {
        vm.prank(creator);
        (uint256 launchId, address token) = factory.createLaunch{value: launchFee + 1 ether}(
            _metadata("Initial", "INIT", "ipfs://initial", "initial"),
            _curve(10 ether),
            _config()
        );

        assertGt(IB20(token).balanceOf(creator), 0);
        (,,,, uint256 realEthReserve, uint256 grossEthRaised, uint256 graduationTarget,,,,,,,,,,) =
            market.launches(launchId);
        assertGt(realEthReserve, 0.9 ether);
        assertEq(grossEthRaised, 1 ether);
        assertEq(graduationTarget, 5 ether);
    }

    function testCreatorInitialBuyIsCapped() public {
        vm.prank(creator);
        vm.expectRevert(LaunchFactory.InitialBuyTooLarge.selector);
        factory.createLaunch{value: launchFee + 6 ether}(
            _metadata("TooMuch", "MUCH", "ipfs://initial", "too-much"),
            _curve(10 ether),
            _config()
        );
    }

    function testMaxSupplyIsOneBillionAndCreatorAllocationIsZero() public {
        (uint256 launchId, address token) = _createLaunch("FixedSupply", "FIX", 10 ether);

        (,,,,,,, uint256 maxSupply,, uint256 creatorAllocation,,,,,,,) = market.launches(launchId);
        assertEq(maxSupply, 1_000_000_000 ether);
        assertEq(creatorAllocation, 0);
        assertEq(IB20(token).supplyCap(), 1_000_000_000 ether);
        assertEq(IB20(token).totalSupply(), 1_000_000_000 ether);
        assertEq(IB20(token).balanceOf(address(market)), 1_000_000_000 ether);
        assertFalse(IB20(token).hasRole(IB20(token).MINT_ROLE(), address(market)));
        assertFalse(IB20(token).hasRole(IB20(token).MINT_ROLE(), address(graduation)));
        assertFalse(IB20(token).hasRole(IB20(token).MINT_ROLE(), address(b20Factory)));
    }

    function testExactFiveEthGrossGraduates() public {
        (uint256 launchId,) = _createLaunch("FiveGross", "FIVE", 10 ether);
        vm.warp(block.timestamp + 61);

        vm.prank(buyer);
        market.buy{value: 5 ether}(launchId, 0, block.timestamp + 1 hours);

        (,,,, uint256 realEthReserve, uint256 grossEthRaised, uint256 graduationTarget,,,,,,,,, bool ready,) =
            market.launches(launchId);
        assertTrue(ready);
        assertEq(grossEthRaised, graduationTarget);
        assertEq(realEthReserve, 4.95 ether);
    }

    function testBuyRefundsExcessAtGraduation() public {
        (uint256 launchId,) = _createLaunch("Refund", "RFND", 1 ether);
        vm.warp(block.timestamp + 61);

        uint256 beforeBalance = buyer.balance;
        vm.prank(buyer);
        market.buy{value: 10 ether}(launchId, 0, block.timestamp + 1 hours);

        (,,,, uint256 realEthReserve, uint256 grossEthRaised, uint256 graduationTarget,,,,,,,,, bool ready,) =
            market.launches(launchId);
        assertTrue(ready);
        assertEq(grossEthRaised, graduationTarget);
        assertEq(realEthReserve, 4.95 ether);
        assertEq(beforeBalance - buyer.balance, 5 ether);
    }

    function testSellBeforeGraduation() public {
        (uint256 launchId, address token) = _createLaunch("Sellable", "SELL", 10 ether);

        vm.prank(seller);
        uint256 bought = market.buy{value: 0.5 ether}(launchId, 0, block.timestamp + 1 hours);

        vm.prank(seller);
        IB20(token).approve(address(market), bought / 2);

        uint256 quote;
        (quote,) = market.quoteSell(launchId, bought / 2);
        vm.prank(seller);
        market.sell(launchId, bought / 2, quote - 1, block.timestamp + 1 hours);

        assertGt(seller.balance, 9 ether);
        assertEq(IB20(token).totalSupply(), 1_000_000_000 ether);
    }

    function testSellReturnsTokensToReusableMarketReserve() public {
        (uint256 launchId, address token) = _createLaunch("Reusable", "REUSE", 10 ether);
        vm.warp(block.timestamp + 61);

        uint256 startingMarketBalance = IB20(token).balanceOf(address(market));

        vm.prank(seller);
        uint256 bought = market.buy{value: 1 ether}(launchId, 0, block.timestamp + 1 hours);
        uint256 marketBalanceAfterBuy = IB20(token).balanceOf(address(market));
        assertEq(startingMarketBalance - marketBalanceAfterBuy, bought);

        uint256 sold = bought / 2;
        vm.prank(seller);
        IB20(token).approve(address(market), sold);
        vm.prank(seller);
        market.sell(launchId, sold, 0, block.timestamp + 1 hours);

        assertEq(IB20(token).totalSupply(), 1_000_000_000 ether);
        assertEq(IB20(token).balanceOf(address(market)), marketBalanceAfterBuy + sold);

        vm.prank(buyer);
        market.buy{value: 10 ether}(launchId, 0, block.timestamp + 1 hours);
        graduation.graduate(launchId);

        assertEq(IB20(token).totalSupply(), 1_000_000_000 ether);
        assertEq(IB20(token).balanceOf(address(market)), 0);
    }

    function testWalletCapAndAntiSniping() public {
        vm.prank(creator);
        (uint256 launchId,) = factory.createLaunch{value: launchFee}(
            _metadata("Guarded", "GUARD", "ipfs://guard", "guard"),
            _curve(10 ether),
            _config()
        );

        vm.prank(buyer);
        vm.expectRevert(BondingCurveMarket.AntiSnipingLimit.selector);
        market.buy{value: 5 ether}(launchId, 0, block.timestamp + 1 hours);
    }

    function testFactoryRejectsUnsafeConfig() public {
        BondingCurveMarket.LaunchConfig memory config = _config();
        config.creatorFeeBps = 900;

        vm.prank(creator);
        vm.expectRevert(LaunchFactory.UnsafeTradingConfig.selector);
        factory.createLaunch{value: launchFee}(_metadata("Unsafe", "BAD", "ipfs://bad", "bad"), _curve(10 ether), config);
    }

    function testFeeSplitAndCreatorCanClaim() public {
        (uint256 launchId,) = _createLaunch("Fees", "FEE", 10 ether);

        vm.prank(buyer);
        market.buy{value: 1 ether}(launchId, 0, block.timestamp + 1 hours);

        assertGt(market.pendingFees(creator), 0);
        uint256 pendingCreatorFees = market.pendingFees(creator);
        uint256 beforeBalance = creator.balance;

        vm.prank(creator);
        market.claimFees();

        assertEq(market.pendingFees(creator), 0);
        assertEq(creator.balance, beforeBalance + pendingCreatorFees);
    }

    function testLaunchFeeIsRequiredAndClaimable() public {
        vm.prank(creator);
        vm.expectRevert(LaunchFactory.InsufficientLaunchFee.selector);
        factory.createLaunch(_metadata("NoFee", "NOF", "ipfs://nofee", "nofee"), _curve(10 ether), _config());

        uint256 beforePending = factory.pendingLaunchFees();
        _createLaunch("PaidFee", "PAID", 10 ether);
        assertEq(factory.pendingLaunchFees(), beforePending + launchFee);

        uint256 beforeTreasury = feeRecipient.balance;
        uint256 claimable = factory.pendingLaunchFees();
        factory.claimLaunchFees();

        assertEq(factory.pendingLaunchFees(), 0);
        assertEq(feeRecipient.balance, beforeTreasury + claimable);
    }

    function testEmergencyCloseRequiresTimelockAndOnlyUnbonded() public {
        (uint256 launchId,) = _createLaunch("Emergency", "EMR", 10 ether);
        vm.prank(buyer);
        market.buy{value: 1 ether}(launchId, 0, block.timestamp + 1 hours);

        market.scheduleEmergencyClose(launchId);
        vm.expectRevert(BondingCurveMarket.EmergencyDelayNotElapsed.selector);
        market.emergencyCloseUnbonded(launchId, payable(address(this)));

        vm.warp(block.timestamp + market.EMERGENCY_DELAY());
        uint256 beforeBalance = address(this).balance;
        uint256 amount = market.emergencyCloseUnbonded(launchId, payable(address(this)));
        assertGt(amount, 0);
        assertEq(address(this).balance, beforeBalance + amount);

        vm.prank(buyer);
        vm.expectRevert(BondingCurveMarket.LaunchEmergencyClosed.selector);
        market.buy{value: 0.1 ether}(launchId, 0, block.timestamp + 3 days);
    }

    function testEmergencyCloseCannotTouchBondedLaunch() public {
        (uint256 launchId,) = _createLaunch("Bonded", "BOND", 1 ether);
        vm.warp(block.timestamp + 61);
        vm.prank(buyer);
        market.buy{value: 5.2 ether}(launchId, 0, block.timestamp + 1 hours);

        vm.expectRevert(BondingCurveMarket.TradingClosed.selector);
        market.scheduleEmergencyClose(launchId);
    }

    function testGraduationLocksLiquidityAndRenouncesRoles() public {
        (uint256 launchId, address token) = _createLaunch("Graduate", "GRAD", 1 ether);

        vm.warp(block.timestamp + 61);
        vm.prank(buyer);
        market.buy{value: 5.2 ether}(launchId, 0, block.timestamp + 1 hours);

        (,,,,,,,,,,,,,,, bool ready, bool graduatedBefore) = market.launches(launchId);
        assertTrue(ready);
        assertFalse(graduatedBefore);

        graduation.graduate(launchId);

        (,,,,,,,,,,,,,,, bool readyAfter, bool graduatedAfter) = market.launches(launchId);
        assertTrue(readyAfter);
        assertTrue(graduatedAfter);
        assertEq(IB20(token).totalSupply(), 1_000_000_000 ether);
        assertEq(IB20(token).balanceOf(address(market)), 0);
        assertGt(IB20(token).balanceOf(address(locker)), 0);
        assertFalse(IB20(token).hasRole(IB20(token).MINT_ROLE(), address(market)));
        assertFalse(IB20(token).hasRole(IB20(token).MINT_ROLE(), address(graduation)));
        assertFalse(IB20(token).hasRole(IB20(token).DEFAULT_ADMIN_ROLE(), address(graduation)));
    }

    function testGraduationRequiresDexBackedLocker() public {
        ProtocolLiquidityLocker escrowLocker = new ProtocolLiquidityLocker(address(this));
        GraduationManager unsafeGraduation = new GraduationManager(
            market,
            escrowLocker,
            IPolicyRegistry(address(policy))
        );
        escrowLocker.setGraduationManager(address(unsafeGraduation));
        market.configure(address(factory), address(unsafeGraduation), feeRecipient);

        LaunchFactory unsafeFactory = new LaunchFactory(
            address(this),
            b20Factory,
            IActivationRegistry(address(activation)),
            IPolicyRegistry(address(policy)),
            market,
            address(unsafeGraduation),
            payable(feeRecipient)
        );
        market.configure(address(unsafeFactory), address(unsafeGraduation), feeRecipient);

        vm.prank(creator);
        (uint256 launchId,) = unsafeFactory.createLaunch{value: launchFee}(
            _metadata("NoDex", "NODEX", "ipfs://nodex", "nodex"),
            _curve(10 ether),
            _config()
        );

        vm.warp(block.timestamp + 61);
        vm.prank(buyer);
        market.buy{value: 5.2 ether}(launchId, 0, block.timestamp + 1 hours);

        vm.expectRevert(GraduationManager.LiquidityLockerNotDexBacked.selector);
        unsafeGraduation.graduate(launchId);
    }

    function testCannotSellAfterGraduationReady() public {
        (uint256 launchId, address token) = _createLaunch("Locked", "LOCK", 1 ether);
        vm.warp(block.timestamp + 61);
        vm.prank(buyer);
        uint256 bought = market.buy{value: 5.2 ether}(launchId, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        IB20(token).approve(address(market), bought);
        vm.prank(buyer);
        vm.expectRevert(BondingCurveMarket.TradingClosed.selector);
        market.sell(launchId, bought, 0, block.timestamp + 1 hours);
    }

    function _createLaunch(string memory name, string memory symbol, uint256 graduationTarget)
        internal
        returns (uint256 launchId, address token)
    {
        return _createLaunch(name, symbol, graduationTarget, _config());
    }

    function _createLaunch(
        string memory name,
        string memory symbol,
        uint256 graduationTarget,
        BondingCurveMarket.LaunchConfig memory config
    ) internal returns (uint256 launchId, address token) {
        vm.prank(creator);
        return factory.createLaunch{value: launchFee}(_metadata(name, symbol, "ipfs://meta", name), _curve(graduationTarget), config);
    }

    function _metadata(string memory name, string memory symbol, string memory uri, string memory saltText)
        internal
        pure
        returns (LaunchFactory.TokenMetadata memory)
    {
        return LaunchFactory.TokenMetadata({
            name: name,
            symbol: symbol,
            contractURI: uri,
            salt: keccak256(bytes(saltText))
        });
    }

    function _curve(uint256 graduationTarget) internal pure returns (BondingCurveMarket.CurveConfig memory) {
        return BondingCurveMarket.CurveConfig({
            virtualTokenReserve: 1_000_000_000 ether,
            virtualEthReserve: 1.25 ether,
            graduationEthTarget: graduationTarget,
            maxSupply: 1_000_000_000 ether
        });
    }

    function _config() internal pure returns (BondingCurveMarket.LaunchConfig memory) {
        return BondingCurveMarket.LaunchConfig({
            perWalletCap: 900_000_000 ether,
            creatorAllocation: 0,
            platformFeeBps: 70,
            creatorFeeBps: 30,
            antiSnipingDuration: 60,
            antiSnipingMaxBuy: 500_000_000 ether
        });
    }

}
