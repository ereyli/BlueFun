// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Common readiness probe for a DEX integration approved for Arc.
interface IArcDexAdapterStatus {
    function isReady() external view returns (bool);
}

/// @notice Deferred DEX integration used when an Arc Bond launch graduates.
interface IArcBondDexAdapter is IArcDexAdapterStatus {
    function lockBondLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        payable
        returns (bytes32 positionId);
}

/// @notice Deferred DEX integration used by Arc Direct launches.
/// @dev The adapter receives the complete token supply before this call. When
///      `initialBuyUsdc` is non-zero it must deliver the purchased tokens to
///      `creator` and return the exact amount delivered.
interface IArcDirectDexAdapter is IArcDexAdapterStatus {
    function createDirectLaunch(
        uint256 launchId,
        address token,
        uint256 tokenAmount,
        address creator,
        bytes32 approvedConfigHash,
        uint256 minimumTokensOut
    ) external payable returns (bytes32 poolId, bytes32 positionId, uint256 creatorTokensOut);
}
