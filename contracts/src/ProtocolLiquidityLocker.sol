// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ILiquidityLocker} from "./interfaces/ILiquidityLocker.sol";

contract ProtocolLiquidityLocker is ILiquidityLocker {
    error NotOwner();
    error NotGraduationManager();
    error ZeroAmount();
    error AlreadyConfigured();

    struct LockedPosition {
        uint256 launchId;
        address token;
        uint256 tokenAmount;
        uint256 ethAmount;
        address creator;
        uint64 lockedAt;
    }

    address public immutable owner;
    address public graduationManager;
    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;

    event LiquidityPositionLocked(
        bytes32 indexed positionId,
        uint256 indexed launchId,
        address indexed token,
        uint256 tokenAmount,
        uint256 ethAmount
    );

    constructor(address owner_) {
        owner = owner_;
    }

    function setGraduationManager(address graduationManager_) external {
        if (msg.sender != owner) revert NotOwner();
        if (graduationManager != address(0)) revert AlreadyConfigured();
        graduationManager = graduationManager_;
    }

    receive() external payable {}

    function isDexBacked() external pure returns (bool) {
        return false;
    }

    function lockLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        payable
        returns (bytes32 positionId)
    {
        if (msg.sender != graduationManager) revert NotGraduationManager();
        if (tokenAmount == 0 || msg.value == 0) revert ZeroAmount();

        positionId = keccak256(abi.encode(block.chainid, launchId, token, tokenAmount, msg.value, block.timestamp));
        lockedPositions[positionId] = LockedPosition({
            launchId: launchId,
            token: token,
            tokenAmount: tokenAmount,
            ethAmount: msg.value,
            creator: creator,
            lockedAt: uint64(block.timestamp)
        });

        emit LiquidityPositionLocked(positionId, launchId, token, tokenAmount, msg.value);
    }
}
