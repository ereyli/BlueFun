// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IB20 {
    enum PausableFeature {
        TRANSFER,
        MINT,
        BURN
    }

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event LastAdminRenounced(address indexed previousAdmin);

    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);
    function MINT_ROLE() external view returns (bytes32);
    function PAUSE_ROLE() external view returns (bytes32);
    function UNPAUSE_ROLE() external view returns (bytes32);
    function TRANSFER_SENDER_POLICY() external view returns (bytes32);
    function TRANSFER_RECEIVER_POLICY() external view returns (bytes32);
    function TRANSFER_EXECUTOR_POLICY() external view returns (bytes32);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function hasRole(bytes32 role, address account) external view returns (bool);
    function policyId(bytes32 policyScope) external view returns (uint64);

    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external;
    function updateSupplyCap(uint256 newSupplyCap) external;
    function updateContractURI(string calldata newURI) external;
    function updatePolicy(bytes32 policyScope, uint64 newPolicyId) external;
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address callerConfirmation) external;
    function renounceLastAdmin() external;
    function pause(PausableFeature[] calldata features) external;
    function unpause(PausableFeature[] calldata features) external;
}
