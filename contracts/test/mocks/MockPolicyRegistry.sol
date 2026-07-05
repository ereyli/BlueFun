// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract MockPolicyRegistry {
    mapping(uint64 policyId => bool exists) public policies;

    function setPolicy(uint64 policyId, bool exists) external {
        policies[policyId] = exists;
    }

    function policyExists(uint64 policyId) external view returns (bool) {
        return policies[policyId];
    }
}

