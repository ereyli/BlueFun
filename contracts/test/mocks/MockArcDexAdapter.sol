// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IArcBondDexAdapter, IArcDirectDexAdapter} from "../../src/arc/IArcDexAdapter.sol";

interface IMockArcToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract MockArcDexAdapter is IArcBondDexAdapter, IArcDirectDexAdapter {
    error InvalidConfig();
    error InvalidSupply();
    error TokenTransferFailed();

    struct BondPosition {
        uint256 launchId;
        address token;
        uint256 tokenAmount;
        uint256 usdcAmount;
        address creator;
    }

    bool public ready = true;
    bytes32 public immutable configHash;
    mapping(bytes32 positionId => BondPosition position) public bondPositions;

    constructor(bytes32 configHash_) {
        configHash = configHash_;
    }

    function setReady(bool value) external {
        ready = value;
    }

    function isReady() external view returns (bool) {
        return ready;
    }

    function lockBondLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        payable
        returns (bytes32 positionId)
    {
        if (IMockArcToken(token).balanceOf(address(this)) < tokenAmount) revert InvalidSupply();
        positionId = keccak256(abi.encode("ARC_BOND", launchId, token, tokenAmount, msg.value, creator));
        bondPositions[positionId] = BondPosition(launchId, token, tokenAmount, msg.value, creator);
    }

    function createDirectLaunch(
        uint256 launchId,
        address token,
        uint256 tokenAmount,
        address creator,
        bytes32 approvedConfigHash,
        uint256 minimumTokensOut
    ) external payable returns (bytes32 poolId, bytes32 positionId, uint256 creatorTokensOut) {
        if (approvedConfigHash != configHash) revert InvalidConfig();
        if (IMockArcToken(token).balanceOf(address(this)) != tokenAmount) revert InvalidSupply();
        if (msg.value != 0) {
            creatorTokensOut = msg.value * 1_000;
            if (creatorTokensOut < minimumTokensOut) revert InvalidConfig();
            if (!IMockArcToken(token).transfer(creator, creatorTokensOut)) revert TokenTransferFailed();
        }
        poolId = keccak256(abi.encode("ARC_DIRECT_POOL", launchId, token, approvedConfigHash));
        positionId = keccak256(abi.encode("ARC_DIRECT_POSITION", launchId, token, tokenAmount));
    }
}
