// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {SafeTransferLib} from "./SafeTransferLib.sol";

interface IWrappedNativeSettlement {
    function deposit() external payable;
}

/// @notice Sends native proceeds immediately and falls back to wrapped native currency.
/// @dev The gas cap prevents a hostile recipient from consuming the settlement transaction.
library NativeSettlement {
    error InvalidWrappedNative();

    uint256 internal constant NATIVE_TRANSFER_GAS_LIMIT = 30_000;

    function validate(address wrappedNative) internal view {
        if (wrappedNative == address(0) || wrappedNative.code.length == 0) revert InvalidWrappedNative();
    }

    /// @return paidAsWrapped True when the recipient rejected native currency and received WETH instead.
    function pay(address wrappedNative, address recipient, uint256 amount) internal returns (bool paidAsWrapped) {
        if (amount == 0) return false;

        (bool sent,) = payable(recipient).call{value: amount, gas: NATIVE_TRANSFER_GAS_LIMIT}("");
        if (sent) return false;

        IWrappedNativeSettlement(wrappedNative).deposit{value: amount}();
        SafeTransferLib.safeTransfer(wrappedNative, recipient, amount);
        return true;
    }
}
