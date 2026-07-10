// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ILiquidityLocker} from "../../src/interfaces/ILiquidityLocker.sol";

contract MockLiquidityLocker is ILiquidityLocker {
    struct Position {
        uint256 launchId;
        address token;
        uint256 tokenAmount;
        uint256 ethAmount;
    }

    mapping(bytes32 positionId => Position position) public positions;

    event MockPositionLocked(
        bytes32 indexed positionId,
        uint256 indexed launchId,
        address indexed token,
        uint256 tokenAmount,
        uint256 ethAmount
    );

    function isDexBacked() external pure returns (bool) {
        return true;
    }

    function lockLiquidity(uint256 launchId, address token, uint256 tokenAmount, address)
        external
        payable
        returns (bytes32 positionId)
    {
        positionId = keccak256(abi.encode(block.chainid, launchId, token, tokenAmount, msg.value));
        positions[positionId] =
            Position({launchId: launchId, token: token, tokenAmount: tokenAmount, ethAmount: msg.value});
        emit MockPositionLocked(positionId, launchId, token, tokenAmount, msg.value);
    }
}
