// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function deal(address who, uint256 newBalance) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function warp(uint256) external;
    function etch(address target, bytes calldata code) external;
}

contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value) internal pure {
        require(value, "assertTrue failed");
    }

    function assertFalse(bool value) internal pure {
        require(!value, "assertFalse failed");
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "assertEq uint failed");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "assertEq address failed");
    }

    function assertGt(uint256 a, uint256 b) internal pure {
        require(a > b, "assertGt failed");
    }
}
