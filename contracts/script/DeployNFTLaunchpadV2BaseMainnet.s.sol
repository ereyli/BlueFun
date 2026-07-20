// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Permanently disabled historical entry point. It must never deploy current source bytecode.
contract DeployNFTLaunchpadV2BaseMainnet {
    error DeprecatedDeploymentScript();

    function run() external pure {
        revert DeprecatedDeploymentScript();
    }
}
