// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BlueRevenueRouter} from "../src/BlueRevenueRouter.sol";
import {BlueStakingVault} from "../src/BlueStakingVault.sol";
import {TwoStepAdmin} from "../src/access/TwoStepAdmin.sol";
import {StakingTimelock} from "../src/StakingTimelock.sol";
import {Test, Vm} from "./utils/Test.sol";

contract MockRevenueToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
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

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ALLOWANCE");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0) && balanceOf[from] >= amount, "TRANSFER");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockWeth is MockRevenueToken {
    constructor() MockRevenueToken("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        totalSupply += msg.value;
        balanceOf[msg.sender] += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }
}

contract BlueStakingVaultTest is Test {
    uint64 internal constant REWARD_DURATION = 7 days;
    uint64 internal constant COOLDOWN = 30 days;
    uint256 internal constant STREAMED_REWARD = uint256(REWARD_DURATION) * 1e12;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant GUARDIAN = address(0x600D);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant OUTSIDER = address(0xBAD);

    MockRevenueToken internal blue;
    MockWeth internal weth;
    BlueRevenueRouter internal router;
    BlueStakingVault internal vault;

    function setUp() public {
        blue = new MockRevenueToken("BLUE", "BLUE");
        weth = new MockWeth();
        router = new BlueRevenueRouter(
            address(blue),
            address(weth),
            address(this),
            GUARDIAN,
            TREASURY,
            address(this),
            5_000,
            REWARD_DURATION,
            COOLDOWN
        );
        vault = router.vault();

        blue.mint(ALICE, 1_000_000_000 ether);
        blue.mint(BOB, 1_000_000_000 ether);
        weth.mint(address(this), 1_000_000 ether);
        weth.approve(address(router), type(uint256).max);
        vm.prank(ALICE);
        blue.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        blue.approve(address(vault), type(uint256).max);
    }

    function testRoutesHalfOfRevenueAndStreamsProRata() public {
        _stake(ALICE, 100 ether);
        _stake(BOB, 300 ether);
        router.distributeWeth(STREAMED_REWARD * 2);

        assertEq(weth.balanceOf(TREASURY), STREAMED_REWARD);
        assertEq(vault.rewardRate(), 1e12);
        vm.warp(block.timestamp + REWARD_DURATION);

        uint256 aliceEarned = vault.earned(ALICE);
        uint256 bobEarned = vault.earned(BOB);
        assertEq(aliceEarned, STREAMED_REWARD / 4);
        assertEq(bobEarned, (STREAMED_REWARD * 3) / 4);

        vm.prank(ALICE);
        vault.claimReward(ALICE);
        vm.prank(BOB);
        vault.claimReward(BOB);
        assertEq(weth.balanceOf(ALICE), STREAMED_REWARD / 4);
        assertEq(weth.balanceOf(BOB), (STREAMED_REWARD * 3) / 4);
        assertEq(vault.accountedRewardBalance(), 0);
    }

    function testRewardsQueueWithoutStakersAndStartOnFirstStake() public {
        router.distributeWeth(STREAMED_REWARD * 2);
        assertEq(vault.rewardRate(), 0);
        assertEq(vault.queuedRewards(), STREAMED_REWARD);

        _stake(ALICE, 100 ether);
        assertEq(vault.queuedRewards(), 0);
        assertEq(vault.rewardRate(), 1e12);
        vm.warp(block.timestamp + REWARD_DURATION);
        assertEq(vault.earned(ALICE), STREAMED_REWARD);
    }

    function testNewStakeCannotEarnRevenueFromBeforeItJoined() public {
        _stake(ALICE, 100 ether);
        router.distributeWeth(STREAMED_REWARD * 2);
        vm.warp(block.timestamp + 3 days);
        _stake(BOB, 100 ether);
        vm.warp(block.timestamp + 4 days);

        assertEq(vault.earned(ALICE), 5 days * 1e12);
        assertEq(vault.earned(BOB), 2 days * 1e12);
        assertEq(vault.earned(ALICE) + vault.earned(BOB), STREAMED_REWARD);
    }

    function testAdditionalRevenuePreservesAccruedAndUnvestedRewards() public {
        _stake(ALICE, 100 ether);
        router.distributeWeth(STREAMED_REWARD * 2);
        vm.warp(block.timestamp + 2 days);
        uint256 accruedBefore = vault.earned(ALICE);
        router.distributeWeth(STREAMED_REWARD * 2);
        assertEq(vault.earned(ALICE), accruedBefore);
        vm.warp(block.timestamp + REWARD_DURATION);
        assertEq(vault.earned(ALICE) + vault.queuedRewards(), STREAMED_REWARD * 2);
    }

    function testLastExitQueuesUnusedRewardsAndNextStakeRestartsThem() public {
        _stake(ALICE, 100 ether);
        router.distributeWeth(STREAMED_REWARD * 2);
        vm.warp(block.timestamp + 2 days);
        vm.prank(ALICE);
        vault.requestUnstake(100 ether);

        uint256 queued = vault.queuedRewards();
        assertEq(queued, 5 days * 1e12);
        assertEq(vault.rewardRate(), 0);
        _stake(BOB, 100 ether);
        assertGt(vault.rewardRate(), 0);
        vm.warp(block.timestamp + REWARD_DURATION);
        assertEq(vault.earned(ALICE), 2 days * 1e12);
        assertLe(vault.earned(BOB), queued);
        assertGt(vault.earned(BOB), queued - REWARD_DURATION);
    }

    function testCooldownCannotBeBypassedAndDoesNotRelockOtherUsers() public {
        _stake(ALICE, 100 ether);
        vm.prank(ALICE);
        vault.requestUnstake(40 ether);
        assertEq(vault.activeBalanceOf(ALICE), 60 ether);
        assertEq(vault.coolingBalanceOf(ALICE), 40 ether);

        vm.warp(block.timestamp + COOLDOWN - 1);
        vm.prank(ALICE);
        vm.expectRevert(BlueStakingVault.CooldownNotFinished.selector);
        vault.withdraw(ALICE);

        vm.warp(block.timestamp + 1);
        vm.prank(ALICE);
        vault.withdraw(ALICE);
        assertEq(blue.balanceOf(ALICE), 1_000_000_000 ether - 60 ether);
        assertEq(vault.stakeLiability(), 60 ether);
    }

    function testCancelCooldownRestoresOnlyFutureRewardWeight() public {
        _stake(ALICE, 100 ether);
        router.distributeWeth(STREAMED_REWARD * 2);
        vm.prank(ALICE);
        vault.requestUnstake(100 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(ALICE);
        vault.cancelUnstake();
        assertEq(vault.activeBalanceOf(ALICE), 100 ether);
        assertEq(vault.earned(ALICE), 0);
        vm.warp(block.timestamp + 1 days);
        assertGt(vault.earned(ALICE), 0);
    }

    function testPauseNeverBlocksExitOrClaims() public {
        _stake(ALICE, 100 ether);
        router.distributeWeth(STREAMED_REWARD * 2);
        vm.warp(block.timestamp + 1 days);
        vm.prank(GUARDIAN);
        vault.pause();

        vm.prank(BOB);
        vm.expectRevert(BlueStakingVault.StakingPaused.selector);
        vault.stake(1 ether);
        vm.expectRevert(BlueStakingVault.RewardsPaused.selector);
        router.distributeWeth(STREAMED_REWARD * 2);

        vm.prank(ALICE);
        vault.claimReward(ALICE);
        vm.prank(ALICE);
        vault.requestUnstake(100 ether);
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(ALICE);
        vault.withdraw(ALICE);
        assertEq(blue.balanceOf(ALICE), 1_000_000_000 ether);
    }

    function testEmergencyExitIsIrreversibleAndCannotSeizeUserFunds() public {
        _stake(ALICE, 100 ether);
        vm.prank(GUARDIAN);
        vault.enableEmergencyExit();
        vm.prank(ALICE);
        vault.emergencyWithdraw(ALICE);
        assertEq(blue.balanceOf(ALICE), 1_000_000_000 ether);
        assertEq(vault.stakeLiability(), 0);

        vm.prank(ALICE);
        vm.expectRevert(BlueStakingVault.EmergencyMode.selector);
        vault.stake(1 ether);
        vm.expectRevert(BlueStakingVault.EmergencyMode.selector);
        vault.setPauseStates(false, false);
    }

    function testAdminCanRecoverOnlySurplusAndUnrelatedAssets() public {
        _stake(ALICE, 100 ether);
        vm.prank(BOB);
        assertTrue(blue.transfer(address(vault), 10 ether));
        vault.recoverSurplusStakingToken(BOB, 10 ether);
        assertEq(vault.stakeLiability(), 100 ether);

        vm.expectRevert(BlueStakingVault.InsufficientSurplus.selector);
        vault.recoverSurplusStakingToken(BOB, 1);
        vm.expectRevert(BlueStakingVault.ProtectedAsset.selector);
        vault.recoverToken(address(weth), BOB, 1);
        vm.expectRevert(BlueStakingVault.ProtectedAsset.selector);
        vault.recoverToken(address(blue), BOB, 1);

        MockRevenueToken other = new MockRevenueToken("Other", "OTHER");
        other.mint(address(vault), 5 ether);
        vault.recoverToken(address(other), BOB, 5 ether);
        assertEq(other.balanceOf(BOB), 5 ether);
    }

    function testRewardSurplusNeedsDistributorAndBecomesClaimable() public {
        assertTrue(weth.transfer(address(vault), STREAMED_REWARD));
        vm.prank(OUTSIDER);
        vm.expectRevert(BlueStakingVault.NotDistributor.selector);
        vault.syncRewardSurplus();

        router.syncVaultRewardSurplus();
        assertEq(vault.queuedRewards(), STREAMED_REWARD);
        _stake(ALICE, 1 ether);
        vm.warp(block.timestamp + REWARD_DURATION);
        assertEq(vault.earned(ALICE), STREAMED_REWARD);
    }

    function testOnlyOperatorCanRouteAndAdminSettingsAreFlexible() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(BlueRevenueRouter.NotRevenueOperator.selector);
        router.distributeWeth(1 ether);

        router.setStakingShareBps(6_000);
        router.setRevenueOperator(BOB);
        router.setTreasury(ALICE);
        assertEq(router.stakingShareBps(), 6_000);
        assertEq(router.revenueOperator(), BOB);
        assertEq(router.treasury(), ALICE);

        vm.prank(OUTSIDER);
        vm.expectRevert(TwoStepAdmin.NotAdmin.selector);
        router.setStakingShareBps(5_000);
        router.proposeAdmin(BOB);
        vm.prank(BOB);
        router.acceptAdmin();
        assertEq(router.admin(), BOB);
    }

    function testNativeRevenueIsWrappedAndSplitWithoutNativeCustody() public {
        vm.deal(address(this), 2 ether);
        router.distributeNative{value: 2 ether}();
        assertEq(address(router).balance, 0);
        assertEq(weth.balanceOf(TREASURY), 1 ether);
        assertEq(vault.queuedRewards(), 1 ether);
    }

    function testZeroAndFullStakingShareRemainSolvent() public {
        router.setStakingShareBps(0);
        router.distributeWeth(10 ether);
        assertEq(weth.balanceOf(TREASURY), 10 ether);
        assertEq(weth.balanceOf(address(vault)), 0);

        router.setStakingShareBps(10_000);
        router.distributeWeth(10 ether);
        assertEq(weth.balanceOf(TREASURY), 10 ether);
        assertEq(vault.queuedRewards(), 10 ether);
        assertEq(weth.balanceOf(address(router)), 0);
    }

    function testDurationChangesOnlyAffectFutureRequestsAndSchedules() public {
        _stake(ALICE, 100 ether);
        vm.prank(ALICE);
        vault.requestUnstake(10 ether);
        uint256 originalEnd = vault.cooldownEnd(ALICE);
        vault.setCooldownDuration(60 days);
        assertEq(vault.cooldownEnd(ALICE), originalEnd);

        vault.setRewardsDuration(14 days);
        router.distributeWeth(14 days * 1e12 * 2);
        assertEq(vault.rewardRate(), 1e12);
        assertEq(vault.periodFinish(), block.timestamp + 14 days);
    }

    function testTimelockControlsRevenueSettings() public {
        StakingTimelock governance = new StakingTimelock(address(this), GUARDIAN, 2 days);
        BlueRevenueRouter governedRouter = new BlueRevenueRouter(
            address(blue), address(weth), address(governance), GUARDIAN, TREASURY, address(this), 5_000,
            REWARD_DURATION, COOLDOWN
        );
        bytes memory data = abi.encodeCall(BlueRevenueRouter.setStakingShareBps, (6_000));
        bytes32 salt = keccak256("share-change");
        governance.schedule(address(governedRouter), 0, data, salt);
        vm.expectRevert(StakingTimelock.OperationNotReady.selector);
        governance.execute(address(governedRouter), 0, data, salt);
        vm.warp(block.timestamp + 2 days);
        governance.execute(address(governedRouter), 0, data, salt);
        assertEq(governedRouter.stakingShareBps(), 6_000);
    }

    function testTimelockRolesAndDelayRotateOnlyThroughDelayedSelfCalls() public {
        StakingTimelock governance = new StakingTimelock(address(this), GUARDIAN, 2 days);

        vm.expectRevert(StakingTimelock.NotSelf.selector);
        governance.setGuardian(OUTSIDER);

        bytes memory guardianData = abi.encodeCall(StakingTimelock.setGuardian, (OUTSIDER));
        bytes32 guardianSalt = keccak256("guardian-change");
        governance.schedule(address(governance), 0, guardianData, guardianSalt);
        vm.warp(block.timestamp + 2 days);
        governance.execute(address(governance), 0, guardianData, guardianSalt);
        assertEq(governance.guardian(), OUTSIDER);

        bytes memory delayData = abi.encodeCall(StakingTimelock.setDelay, (uint64(3 days)));
        bytes32 delaySalt = keccak256("delay-change");
        governance.schedule(address(governance), 0, delayData, delaySalt);
        vm.warp(block.timestamp + 2 days);
        governance.execute(address(governance), 0, delayData, delaySalt);
        assertEq(governance.delay(), 3 days);

        bytes memory ownerData = abi.encodeCall(StakingTimelock.proposeOwner, (ALICE));
        bytes32 ownerSalt = keccak256("owner-change");
        governance.schedule(address(governance), 0, ownerData, ownerSalt);
        vm.warp(block.timestamp + 3 days);
        governance.execute(address(governance), 0, ownerData, ownerSalt);
        vm.prank(ALICE);
        governance.acceptOwner();
        assertEq(governance.owner(), ALICE);
    }

    function testGuardianCanCancelTimelockedConfigurationChange() public {
        StakingTimelock governance = new StakingTimelock(address(this), GUARDIAN, 2 days);
        BlueRevenueRouter governedRouter = new BlueRevenueRouter(
            address(blue), address(weth), address(governance), GUARDIAN, TREASURY, address(this), 5_000,
            REWARD_DURATION, COOLDOWN
        );
        bytes memory data = abi.encodeCall(BlueRevenueRouter.setStakingShareBps, (10_000));
        bytes32 salt = keccak256("cancel-share-change");
        bytes32 id = governance.schedule(address(governedRouter), 0, data, salt);
        vm.prank(GUARDIAN);
        governance.cancel(id);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(StakingTimelock.InvalidOperation.selector);
        governance.execute(address(governedRouter), 0, data, salt);
        assertEq(governedRouter.stakingShareBps(), 5_000);
    }

    function testFuzzRewardsStayProportionalAndSolvent(uint96 aliceRaw, uint96 bobRaw) public {
        uint256 aliceStake = 1 ether + (uint256(aliceRaw) % (1_000_000_000 ether - 1 ether));
        uint256 bobStake = 1 ether + (uint256(bobRaw) % (1_000_000_000 ether - 1 ether));
        _stake(ALICE, aliceStake);
        _stake(BOB, bobStake);
        router.distributeWeth(STREAMED_REWARD * 2);
        vm.warp(block.timestamp + REWARD_DURATION);

        uint256 aliceEarned = vault.earned(ALICE);
        uint256 bobEarned = vault.earned(BOB);
        uint256 totalEarned = aliceEarned + bobEarned;
        assertLe(totalEarned, STREAMED_REWARD);
        assertLe(STREAMED_REWARD - totalEarned, ((aliceStake + bobStake) / 1e18) + 2);
        assertLe(totalEarned, weth.balanceOf(address(vault)));
    }

    function _stake(address account, uint256 amount) internal {
        vm.prank(account);
        vault.stake(amount);
    }
}

contract BlueStakingHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockRevenueToken public immutable blue;
    MockWeth public immutable weth;
    BlueRevenueRouter public immutable router;
    BlueStakingVault public immutable vault;
    address[3] public actors;

    constructor(MockRevenueToken blue_, MockWeth weth_, BlueRevenueRouter router_) {
        blue = blue_;
        weth = weth_;
        router = router_;
        vault = router_.vault();
        actors = [address(0x101), address(0x202), address(0x303)];
        for (uint256 i; i < actors.length; ++i) {
            blue.mint(actors[i], 1_000_000_000 ether);
            vm.prank(actors[i]);
            blue.approve(address(vault), type(uint256).max);
        }
        weth.approve(address(router), type(uint256).max);
    }

    function stake(uint256 actorSeed, uint96 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 available = blue.balanceOf(actor);
        if (available == 0) return;
        uint256 amount = 1 + (uint256(rawAmount) % available);
        vm.prank(actor);
        try vault.stake(amount) {} catch {}
    }

    function requestUnstake(uint256 actorSeed, uint96 rawAmount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 active = vault.activeBalanceOf(actor);
        if (active == 0 || vault.coolingBalanceOf(actor) != 0) return;
        uint256 amount = 1 + (uint256(rawAmount) % active);
        vm.prank(actor);
        try vault.requestUnstake(amount) {} catch {}
    }

    function cancel(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (vault.coolingBalanceOf(actor) == 0) return;
        vm.prank(actor);
        try vault.cancelUnstake() {} catch {}
    }

    function withdraw(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint64 end = vault.cooldownEnd(actor);
        if (end == 0) return;
        if (block.timestamp < end) vm.warp(end);
        vm.prank(actor);
        try vault.withdraw(actor) {} catch {}
    }

    function claim(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (vault.earned(actor) == 0) return;
        vm.prank(actor);
        try vault.claimReward(actor) {} catch {}
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = 2 + (uint256(rawAmount) % 100 ether);
        weth.mint(address(this), amount);
        try router.distributeWeth(amount) {} catch {}
    }

    function advance(uint32 rawSeconds) external {
        vm.warp(block.timestamp + 1 + (uint256(rawSeconds) % 60 days));
    }

    function actorAt(uint256 index) external view returns (address) {
        return actors[index];
    }
}

contract BlueStakingInvariantTest is Test {
    MockRevenueToken internal blue;
    MockWeth internal weth;
    BlueRevenueRouter internal router;
    BlueStakingVault internal vault;
    BlueStakingHandler internal handler;
    address[] internal invariantTargets;

    function setUp() public {
        blue = new MockRevenueToken("BLUE", "BLUE");
        weth = new MockWeth();
        router = new BlueRevenueRouter(
            address(blue), address(weth), address(this), address(0x600D), address(0x7EA5), address(this),
            5_000, 7 days, 30 days
        );
        vault = router.vault();
        handler = new BlueStakingHandler(blue, weth, router);
        router.setRevenueOperator(address(handler));
        invariantTargets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return invariantTargets;
    }

    function invariantStakePrincipalAlwaysCoversLiabilities() public view {
        assertEq(blue.balanceOf(address(vault)), vault.totalActiveStake() + vault.totalCoolingStake());
        uint256 activeSum;
        uint256 coolingSum;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actorAt(i);
            activeSum += vault.activeBalanceOf(actor);
            coolingSum += vault.coolingBalanceOf(actor);
        }
        assertEq(activeSum, vault.totalActiveStake());
        assertEq(coolingSum, vault.totalCoolingStake());
    }

    function invariantRewardScheduleIsSolvent() public view {
        assertLe(vault.remainingScheduledRewards() + vault.queuedRewards(), weth.balanceOf(address(vault)));
        assertEq(weth.balanceOf(address(router)), 0);
        assertLe(vault.accountedRewardBalance(), weth.balanceOf(address(vault)));
    }
}
