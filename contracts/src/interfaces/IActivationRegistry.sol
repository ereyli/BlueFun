// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IActivationRegistry {
    function isActivated(bytes32 featureId) external view returns (bool);
}

