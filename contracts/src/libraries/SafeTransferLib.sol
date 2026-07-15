// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice ERC20 transfer helpers that support tokens returning true or no data.
library SafeTransferLib {
    error SafeTransferFailed();
    error SafeTransferFromFailed();
    error SafeApproveFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert SafeTransferFailed();
        }
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert SafeTransferFromFailed();
        }
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!success || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) {
            revert SafeApproveFailed();
        }
    }
}
