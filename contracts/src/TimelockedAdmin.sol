// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

/// @notice Two-key, delayed administrator for mutable launch configuration.
contract TimelockedAdmin is ReentrancyGuard {
    error NotOwner();
    error NotGuardian();
    error InvalidOperation();
    error OperationNotReady();
    error OperationFailed();
    error InvalidAddress();

    address public immutable owner;
    address public immutable guardian;
    uint64 public immutable delay;
    mapping(bytes32 operationId => uint256 readyAt) public readyAt;

    event OperationScheduled(bytes32 indexed operationId, address indexed target, uint256 value, uint256 readyAt);
    event OperationCancelled(bytes32 indexed operationId, address indexed caller);
    event OperationExecuted(bytes32 indexed operationId, address indexed target, uint256 value);

    constructor(address owner_, address guardian_, uint64 delay_) {
        if (owner_ == address(0) || guardian_ == address(0) || owner_ == guardian_ || delay_ < 24 hours) {
            revert InvalidAddress();
        }
        owner = owner_;
        guardian = guardian_;
        delay = delay_;
    }

    receive() external payable {}

    function operationId(address target, uint256 value, bytes calldata data, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), target, value, keccak256(data), salt));
    }

    function schedule(address target, uint256 value, bytes calldata data, bytes32 salt) external returns (bytes32 id) {
        if (msg.sender != owner) revert NotOwner();
        if (target == address(0)) revert InvalidAddress();
        id = operationId(target, value, data, salt);
        if (readyAt[id] != 0) revert InvalidOperation();
        uint256 unlockTime = block.timestamp + delay;
        readyAt[id] = unlockTime;
        emit OperationScheduled(id, target, value, unlockTime);
    }

    function cancel(bytes32 id) external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        if (readyAt[id] == 0) revert InvalidOperation();
        delete readyAt[id];
        emit OperationCancelled(id, msg.sender);
    }

    function execute(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        nonReentrant
        returns (bytes memory result)
    {
        bytes32 id = operationId(target, value, data, salt);
        uint256 unlockTime = readyAt[id];
        if (unlockTime == 0) revert InvalidOperation();
        if (block.timestamp < unlockTime) revert OperationNotReady();
        delete readyAt[id];
        (bool ok, bytes memory returnData) = target.call{value: value}(data);
        if (!ok) revert OperationFailed();
        emit OperationExecuted(id, target, value);
        return returnData;
    }
}
