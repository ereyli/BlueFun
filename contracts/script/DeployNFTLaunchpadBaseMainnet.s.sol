// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Permanently disabled historical entry point. Use DeployNFTLaunchpadV3BaseMainnet only.
contract DeployNFTLaunchpadBaseMainnet {
    error DeprecatedDeploymentScript();

    function run() external pure {
        revert DeprecatedDeploymentScript();
    }
}
