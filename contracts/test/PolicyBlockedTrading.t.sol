// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";

contract PolicyBlockedTradingTest is Test {
    address buyer = address(0xB0B);
    address feeRecipient = address(0xFEE);
    address graduationManager = address(0xDAD);
    uint256 launchId;
    PolicyAwareToken token;
    BondingCurveMarket market;

    receive() external payable {}

    function setUp() public {
        market = new BondingCurveMarket(address(this), feeRecipient);
        market.configure(address(this), graduationManager, feeRecipient);

        token = new PolicyAwareToken();
        token.mint(address(market), 1_000_000_000 ether);

        BondingCurveMarket.CurveConfig memory curve = BondingCurveMarket.CurveConfig({
            virtualTokenReserve: 1_000_000_000 ether,
            virtualEthReserve: 1.25 ether,
            graduationEthTarget: 5 ether,
            maxSupply: 1_000_000_000 ether
        });
        BondingCurveMarket.LaunchConfig memory config = BondingCurveMarket.LaunchConfig({
            perWalletCap: 900_000_000 ether,
            creatorAllocation: 0,
            platformFeeBps: 70,
            creatorFeeBps: 30,
            antiSnipingDuration: 60,
            antiSnipingMaxBuy: 500_000_000 ether
        });

        launchId = market.registerLaunch(address(token), address(this), curve, config);
        vm.deal(buyer, 10 ether);
    }

    function testBuyRevertsWhenTokenPolicyBlocksTransfer() public {
        token.setTransfersAllowed(false);

        vm.prank(buyer);
        vm.expectRevert(PolicyAwareToken.PolicyBlocked.selector);
        market.buy{value: 1 ether}(launchId, 0, block.timestamp + 1 hours);
    }

    function testBuyAndSellWorkWhenTokenPolicyAllowsTransfers() public {
        token.setTransfersAllowed(true);

        vm.warp(block.timestamp + 61);
        vm.prank(buyer);
        market.buy{value: 1 ether}(launchId, 0, block.timestamp + 1 hours);
        uint256 bought = token.balanceOf(buyer);
        assertGt(bought, 0);

        vm.prank(buyer);
        token.approve(address(market), bought / 2);

        vm.prank(buyer);
        uint256 ethOut = market.sell(launchId, bought / 2, 0, block.timestamp + 1 hours);
        assertGt(ethOut, 0);
    }

    function testSellRevertsWhenTokenPolicyBlocksTransferFrom() public {
        token.setTransfersAllowed(true);

        vm.warp(block.timestamp + 61);
        vm.prank(buyer);
        market.buy{value: 1 ether}(launchId, 0, block.timestamp + 1 hours);
        uint256 bought = token.balanceOf(buyer);

        vm.prank(buyer);
        token.approve(address(market), bought / 2);
        token.setTransfersAllowed(false);

        vm.prank(buyer);
        vm.expectRevert(PolicyAwareToken.PolicyBlocked.selector);
        market.sell(launchId, bought / 2, 0, block.timestamp + 1 hours);
    }
}

contract PolicyAwareToken {
    error InsufficientBalance();
    error InsufficientAllowance();
    error PolicyBlocked();

    string public constant name = "Policy Token";
    string public constant symbol = "POL";
    uint8 public constant decimals = 18;
    bool public transfersAllowed = true;
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function setTransfersAllowed(bool allowed) external {
        transfersAllowed = allowed;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (!transfersAllowed) revert PolicyBlocked();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
