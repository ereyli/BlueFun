// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Minimal two-step administration intended to be owned by a timelock.
abstract contract TwoStepAdmin {
    error NotAdmin();
    error NotPendingAdmin();
    error InvalidAdmin();

    address public admin;
    address public pendingAdmin;

    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert InvalidAdmin();
        admin = initialAdmin;
        emit AdminTransferred(address(0), initialAdmin);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0) || newAdmin == admin) revert InvalidAdmin();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        address previousAdmin = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(previousAdmin, msg.sender);
    }
}
