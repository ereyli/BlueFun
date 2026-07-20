// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Permanently disabled historical entry point. Use the complete V3 deployment only.
contract DeployNFTPFPBaseMainnet {
    error DeprecatedDeploymentScript();

    function run() external pure {
        revert DeprecatedDeploymentScript();
    }
}
