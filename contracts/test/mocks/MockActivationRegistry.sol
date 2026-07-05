// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract MockActivationRegistry {
    mapping(bytes32 feature => bool active) public activated;

    function setActivated(bytes32 feature, bool active) external {
        activated[feature] = active;
    }

    function isActivated(bytes32 feature) external view returns (bool) {
        return activated[feature];
    }
}

