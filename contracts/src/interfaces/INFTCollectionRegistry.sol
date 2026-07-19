// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface INFTCollectionRegistry {
    function isBlueFunCollection(address collection) external view returns (bool);
}
