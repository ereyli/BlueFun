// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BlueRevenueRouter} from "../src/BlueRevenueRouter.sol";
import {BlueStakingVault} from "../src/BlueStakingVault.sol";
import {Test} from "./utils/Test.sol";

contract BlueStakingBaseForkTest is Test {
    address internal constant BLUE = 0xb200000000000000000000Af2d07754b927109bc;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant GUARDIAN = address(0x600D);
    address internal constant TREASURY = address(0x7EA5);

    function testForkWiresCanonicalBlueAndStreamsRealBaseWeth() public {
        if (block.chainid != 8453) return;
        assertGt(BLUE.code.length, 0);
        assertGt(WETH.code.length, 0);

        BlueRevenueRouter router = new BlueRevenueRouter(
            BLUE, WETH, address(this), GUARDIAN, TREASURY, address(this), 5_000, 7 days, 30 days
        );
        BlueStakingVault vault = router.vault();
        assertEq(vault.stakingToken(), BLUE);
        assertEq(vault.rewardToken(), WETH);

        vm.deal(address(this), 2 ether);
        router.distributeNative{value: 2 ether}();
        assertEq(vault.queuedRewards(), 1 ether);
        assertEq(vault.accountedRewardBalance(), 1 ether);
        assertEq(router.stakingShareBps(), 5_000);
    }
}
