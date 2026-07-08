// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20} from "../../src/interfaces/IB20.sol";

contract MockB20 is IB20 {
    error UnauthorizedRole();
    error CapExceeded();
    error InsufficientBalance();
    error InsufficientAllowance();

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    string public contractURI;
    uint256 public totalSupply;
    uint256 public supplyCap = type(uint128).max;
    address public immutable factory;
    bool public bootstrapOpen = true;
    bool public adminless;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    mapping(bytes32 role => mapping(address account => bool enabled)) public hasRole;
    mapping(bytes32 scope => uint64 id) public policyId;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant MINT_ROLE = keccak256("MINT_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant UNPAUSE_ROLE = keccak256("UNPAUSE_ROLE");
    bytes32 public constant TRANSFER_SENDER_POLICY = keccak256("TRANSFER_SENDER_POLICY");
    bytes32 public constant TRANSFER_RECEIVER_POLICY = keccak256("TRANSFER_RECEIVER_POLICY");
    bytes32 public constant TRANSFER_EXECUTOR_POLICY = keccak256("TRANSFER_EXECUTOR_POLICY");

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        string memory contractURI_,
        address initialAdmin_,
        address factory_
    ) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        contractURI = contractURI_;
        factory = factory_;
        if (initialAdmin_ != address(0)) {
            hasRole[DEFAULT_ADMIN_ROLE][initialAdmin_] = true;
        }
    }

    modifier onlyAdminOrBootstrap() {
        if (!(bootstrapOpen && msg.sender == factory) && !hasRole[DEFAULT_ADMIN_ROLE][msg.sender]) {
            revert UnauthorizedRole();
        }
        _;
    }

    modifier onlyMinter() {
        if (!hasRole[MINT_ROLE][msg.sender]) revert UnauthorizedRole();
        _;
    }

    function sealBootstrap() external {
        require(msg.sender == factory, "factory only");
        bootstrapOpen = false;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        if (totalSupply + amount > supplyCap) revert CapExceeded();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function updateSupplyCap(uint256 newSupplyCap) external onlyAdminOrBootstrap {
        if (newSupplyCap < totalSupply) revert CapExceeded();
        supplyCap = newSupplyCap;
    }

    function updateContractURI(string calldata newURI) external onlyAdminOrBootstrap {
        contractURI = newURI;
    }

    function updatePolicy(bytes32 policyScope, uint64 newPolicyId) external onlyAdminOrBootstrap {
        policyId[policyScope] = newPolicyId;
    }

    function grantRole(bytes32 role, address account) external onlyAdminOrBootstrap {
        if (adminless) revert UnauthorizedRole();
        hasRole[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external onlyAdminOrBootstrap {
        if (role == DEFAULT_ADMIN_ROLE && hasRole[role][account]) revert UnauthorizedRole();
        hasRole[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    function renounceRole(bytes32 role, address callerConfirmation) external {
        require(callerConfirmation == msg.sender, "bad confirmation");
        hasRole[role][msg.sender] = false;
        emit RoleRevoked(role, msg.sender, msg.sender);
    }

    function renounceLastAdmin() external {
        if (!hasRole[DEFAULT_ADMIN_ROLE][msg.sender]) revert UnauthorizedRole();
        hasRole[DEFAULT_ADMIN_ROLE][msg.sender] = false;
        adminless = true;
        emit RoleRevoked(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
        emit LastAdminRenounced(msg.sender);
    }

    function pause(PausableFeature[] calldata) external view {
        if (!hasRole[PAUSE_ROLE][msg.sender]) revert UnauthorizedRole();
    }

    function unpause(PausableFeature[] calldata) external view {
        if (!hasRole[UNPAUSE_ROLE][msg.sender]) revert UnauthorizedRole();
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

