// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20LaunchFactory} from "../src/Erc20LaunchFactory.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {MockLiquidityLocker} from "./mocks/MockLiquidityLocker.sol";

contract Erc20LaunchpadTest is Test {
    BondingCurveMarket market;
    Erc20LaunchFactory factory;
    Erc20GraduationManager graduation;
    MockLiquidityLocker locker;
    address creator = address(0xCAFE);

    function setUp() public {
        locker = new MockLiquidityLocker();
        market = new BondingCurveMarket(address(this), address(this));
        graduation = new Erc20GraduationManager(market, locker);
        factory = new Erc20LaunchFactory(address(this), market, address(graduation), payable(address(this)));
        market.configure(address(factory), address(graduation), address(this));
        vm.deal(creator, 10 ether);
    }

    function testCreatesFixedSupplyErc20AndTrades() public {
        (uint256 launchId, address token) = _launch(0.102 ether);
        assertEq(launchId, 1);
        assertEq(StandardLaunchToken(token).totalSupply(), 1_000_000_000 ether);
        assertTrue(StandardLaunchToken(token).balanceOf(creator) > 0);
        assertTrue(StandardLaunchToken(token).balanceOf(address(market)) < 1_000_000_000 ether);
    }

    function testGraduationLocksAllRemainingLiquidity() public {
        (uint256 launchId, address token) = _launch(0.002 ether);
        vm.warp(block.timestamp + 61);
        vm.prank(creator);
        market.buy{value: 5 ether}(launchId, 0, block.timestamp + 1);
        graduation.graduate(launchId);
        (,,,,,,,,,,,,,,,, bool graduated) = market.launches(launchId);
        assertTrue(graduated);
        assertEq(StandardLaunchToken(token).balanceOf(address(market)), 0);
        assertTrue(StandardLaunchToken(token).balanceOf(address(locker)) > 0);
    }

    function _launch(uint256 value) private returns (uint256 launchId, address token) {
        Erc20LaunchFactory.TokenMetadata memory metadata =
            Erc20LaunchFactory.TokenMetadata("Robin Token", "ROBIN", "ipfs://metadata", keccak256("robin"));
        BondingCurveMarket.CurveConfig memory curve =
            BondingCurveMarket.CurveConfig(1_000_000_000 ether, 1.25 ether, 5 ether, 1_000_000_000 ether);
        BondingCurveMarket.LaunchConfig memory config =
            BondingCurveMarket.LaunchConfig(900_000_000 ether, 0, 70, 30, 60, 500_000_000 ether);
        vm.prank(creator);
        return factory.createLaunch{value: value}(metadata, curve, config);
    }
}
