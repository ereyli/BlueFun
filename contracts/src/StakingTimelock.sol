// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

/// @notice Delayed, cancellable administration with rotatable owner and guardian roles.
/// @dev Privileged role and delay changes must call this contract through execute().
contract StakingTimelock is ReentrancyGuard {
    error NotOwner();
    error NotGuardian();
    error NotSelf();
    error NotPendingOwner();
    error InvalidOperation();
    error OperationNotReady();
    error OperationFailed();
    error InvalidAddress();
    error InvalidDelay();

    uint64 public constant MIN_DELAY = 2 days;
    uint64 public constant MAX_DELAY = 30 days;

    address public owner;
    address public pendingOwner;
    address public guardian;
    uint64 public delay;
    mapping(bytes32 operationId => uint256 readyAt) public readyAt;

    event OperationScheduled(bytes32 indexed operationId, address indexed target, uint256 value, uint256 readyAt);
    event OperationCancelled(bytes32 indexed operationId, address indexed caller);
    event OperationExecuted(bytes32 indexed operationId, address indexed target, uint256 value);
    event OwnerTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event DelayUpdated(uint256 previousDelay, uint256 newDelay);

    constructor(address owner_, address guardian_, uint64 delay_) {
        if (owner_ == address(0) || guardian_ == address(0) || owner_ == guardian_) revert InvalidAddress();
        _validateDelay(delay_);
        owner = owner_;
        guardian = guardian_;
        delay = delay_;
        emit OwnerTransferred(address(0), owner_);
        emit GuardianUpdated(address(0), guardian_);
        emit DelayUpdated(0, delay_);
    }

    receive() external payable {}

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

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

    /// @notice Anyone may execute after the delay when all scheduled arguments match exactly.
    function execute(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        nonReentrant
        returns (bytes memory result)
    {
        if (target == address(0)) revert InvalidAddress();
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

    function proposeOwner(address newOwner) external onlySelf {
        if (newOwner == address(0) || newOwner == owner) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnerTransferStarted(owner, newOwner);
    }

    function acceptOwner() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerTransferred(previousOwner, msg.sender);
    }

    function setGuardian(address newGuardian) external onlySelf {
        if (newGuardian == address(0) || newGuardian == owner) revert InvalidAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setDelay(uint64 newDelay) external onlySelf {
        _validateDelay(newDelay);
        emit DelayUpdated(delay, newDelay);
        delay = newDelay;
    }

    function _validateDelay(uint64 value) internal pure {
        if (value < MIN_DELAY || value > MAX_DELAY) revert InvalidDelay();
    }
}
