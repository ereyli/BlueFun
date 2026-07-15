// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, Vm} from "./utils/Test.sol";
import {FeePolicy} from "../src/FeePolicy.sol";
import {BaseRevenueRouterV2} from "../src/BaseRevenueRouterV2.sol";
import {BlueStakingVaultV2} from "../src/BlueStakingVaultV2.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";

contract VNextStakingHandler {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    StandardLaunchToken public immutable blue;
    BaseRevenueRouterV2 public immutable router;
    BlueStakingVaultV2 public immutable vault;
    address[3] public actors;

    constructor(StandardLaunchToken blue_, BaseRevenueRouterV2 router_, address funder) {
        blue = blue_;
        router = router_;
        vault = router_.vault();
        actors = [address(0x101), address(0x202), address(0x303)];
        for (uint256 i; i < actors.length; ++i) {
            VM.prank(funder);
            blue.transfer(actors[i], 100_000_000 ether);
            VM.prank(actors[i]);
            blue.approve(address(vault), type(uint256).max);
        }
        VM.deal(address(this), 1_000 ether);
    }

    function stake(uint256 actorSeed, uint96 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 available = blue.balanceOf(actor);
        if (available == 0) return;
        uint256 amount = 1 + (uint256(rawAmount) % available);
        VM.prank(actor);
        try vault.stake(amount) {} catch {}
    }

    function requestUnstake(uint256 actorSeed, uint96 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 active = vault.activeBalanceOf(actor);
        if (active == 0) return;
        uint256 amount = 1 + (uint256(rawAmount) % active);
        VM.prank(actor);
        try vault.requestUnstake(amount) {} catch {}
    }

    function cancel(uint256 actorSeed, uint96 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 cooling = vault.coolingBalanceOf(actor);
        if (cooling == 0) return;
        uint256 amount = 1 + (uint256(rawAmount) % cooling);
        VM.prank(actor);
        try vault.cancelUnstake(amount) {} catch {}
    }

    function withdraw(uint256 actorSeed, uint96 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 cooling = vault.coolingBalanceOf(actor);
        if (cooling == 0) return;
        uint64 end = vault.cooldownEnd(actor);
        if (block.timestamp < end) VM.warp(end);
        uint256 amount = 1 + (uint256(rawAmount) % cooling);
        VM.prank(actor);
        try vault.withdraw(actor, amount) {} catch {}
    }

    function claim(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (vault.earned(actor) == 0) return;
        VM.prank(actor);
        try vault.claimReward(payable(actor)) {} catch {}
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = 2 + (uint256(rawAmount) % 10 ether);
        try router.depositTradeRevenue{value: amount}() {} catch {}
    }

    function advance(uint32 rawSeconds) external {
        VM.warp(block.timestamp + 1 + (uint256(rawSeconds) % 60 days));
    }

    function actorAt(uint256 index) external view returns (address) {
        return actors[index];
    }
}

contract VNextStakingInvariantTest is Test {
    StandardLaunchToken private blue;
    BaseRevenueRouterV2 private router;
    BlueStakingVaultV2 private vault;
    VNextStakingHandler private handler;
    address[] private invariantTargets;

    function setUp() public {
        blue = new StandardLaunchToken("BLUE", "BLUE", "ipfs://blue", address(this), 1_000_000_000 ether);
        FeePolicy policy = new FeePolicy(address(this), address(0xB0B));
        router = new BaseRevenueRouterV2(
            address(blue), address(this), address(0xB0B), policy, address(0xBEEF), 7 days, 30 days
        );
        vault = router.vault();
        handler = new VNextStakingHandler(blue, router, address(this));
        invariantTargets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return invariantTargets;
    }

    function invariantStakePrincipalCoversEveryUser() public view {
        uint256 activeSum;
        uint256 coolingSum;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actorAt(i);
            activeSum += vault.activeBalanceOf(actor);
            coolingSum += vault.coolingBalanceOf(actor);
        }
        assertEq(activeSum, vault.totalActiveStake());
        assertEq(coolingSum, vault.totalCoolingStake());
        assertEq(blue.balanceOf(address(vault)), vault.stakeLiability());
    }

    function invariantNativeRewardsRemainSolvent() public view {
        assertLe(vault.accountedRewardBalance(), address(vault).balance);
        assertLe(vault.remainingScheduledRewards() + vault.queuedRewards(), vault.accountedRewardBalance());
        assertEq(address(router).balance, router.pendingTreasuryRevenue() + router.pendingStakerRevenue());
    }
}
