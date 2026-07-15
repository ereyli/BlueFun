// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {TimelockedAdmin} from "../src/TimelockedAdmin.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";

contract SecurityHardeningTest is Test {
    address owner = address(0xA11CE);
    address guardian = address(0xB0B);

    function testTimelockCannotExecuteEarlyAndGuardianCanCancel() public {
        TimelockedAdmin admin = new TimelockedAdmin(owner, guardian, 48 hours);
        TimelockTarget target = new TimelockTarget();
        bytes memory data = abi.encodeCall(target.setValue, (42));
        bytes32 salt = keccak256("first");

        vm.prank(owner);
        bytes32 id = admin.schedule(address(target), 0, data, salt);
        vm.expectRevert(TimelockedAdmin.OperationNotReady.selector);
        admin.execute(address(target), 0, data, salt);

        vm.prank(guardian);
        admin.cancel(id);
        vm.warp(block.timestamp + 48 hours);
        vm.expectRevert(TimelockedAdmin.InvalidOperation.selector);
        admin.execute(address(target), 0, data, salt);
        assertEq(target.value(), 0);
    }

    function testTimelockExecutesOnlyAfterDelay() public {
        TimelockedAdmin admin = new TimelockedAdmin(owner, guardian, 48 hours);
        TimelockTarget target = new TimelockTarget();
        bytes memory data = abi.encodeCall(target.setValue, (77));
        bytes32 salt = keccak256("second");

        vm.prank(owner);
        admin.schedule(address(target), 0, data, salt);
        vm.warp(block.timestamp + 48 hours);
        admin.execute(address(target), 0, data, salt);
        assertEq(target.value(), 77);
    }

    function testNewBondMarketHasNoEmergencyDrainEntryPoint() public {
        BondingCurveMarket market = new BondingCurveMarket(address(this), address(0xFEE));
        (bool ok,) =
            address(market).call(abi.encodeWithSignature("emergencyCloseUnbonded(uint256,address)", 1, address(this)));
        assertFalse(ok);
    }
}

contract TimelockTarget {
    uint256 public value;

    function setValue(uint256 newValue) external {
        value = newValue;
    }
}
