// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IPolicyRegistry {
    function policyExists(uint64 policyId) external view returns (bool);
}

