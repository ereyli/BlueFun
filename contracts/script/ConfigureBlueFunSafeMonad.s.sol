// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface VmConfigureSafeMonad {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IBlueFunSafeMonad {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function addOwnerWithThreshold(address owner, uint256 threshold) external;
    function changeThreshold(uint256 threshold) external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool success);
}

/// @notice Completes the recovered one-owner Safe initializer into BlueFun's standard 2-of-3 policy.
/// @dev SAFE_BOOTSTRAP_OWNER_PRIVATE_KEY must belong to OWNER_C. It is never the deployer key.
contract ConfigureBlueFunSafeMonad {
    VmConfigureSafeMonad private constant VM =
        VmConfigureSafeMonad(address(uint160(uint256(keccak256("hevm cheat code")))));

    IBlueFunSafeMonad private constant SAFE =
        IBlueFunSafeMonad(0x144A3f70C0bf33124852E3891011e033b909F46d);
    address private constant OWNER_A = 0x7d2Ceb7a0e0C39A3d0f7B5b491659fDE4bb7BCFe;
    address private constant OWNER_B = 0x99344B575b83360410a0E4dCe75189EdECAcc824;
    address private constant OWNER_C = 0xa7A9B7E0c4B36d9dE8A94c6388449d06F2C5952f;

    function run() external {
        require(address(SAFE).code.length != 0, "SAFE_NOT_DEPLOYED");
        if (_isFinalConfiguration()) return;

        uint256 key = VM.envUint("SAFE_BOOTSTRAP_OWNER_PRIVATE_KEY");
        require(VM.addr(key) == OWNER_C, "WRONG_BOOTSTRAP_OWNER");
        require(SAFE.getThreshold() == 1, "BOOTSTRAP_THRESHOLD_NOT_ONE");

        VM.startBroadcast(key);
        if (!_isOwner(OWNER_A)) {
            _execute(abi.encodeCall(SAFE.addOwnerWithThreshold, (OWNER_A, 1)));
        }
        if (!_isOwner(OWNER_B)) {
            _execute(abi.encodeCall(SAFE.addOwnerWithThreshold, (OWNER_B, 1)));
        }
        _execute(abi.encodeCall(SAFE.changeThreshold, (2)));
        VM.stopBroadcast();

        require(_isFinalConfiguration(), "SAFE_CONFIGURATION_FAILED");
    }

    function _execute(bytes memory data) private {
        // v=1 is Safe's prevalidated-signature form; the bootstrap owner is also msg.sender.
        bytes memory signature = abi.encodePacked(bytes32(uint256(uint160(OWNER_C))), bytes32(0), uint8(1));
        require(
            SAFE.execTransaction(
                address(SAFE), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signature
            ),
            "SAFE_TX_FAILED"
        );
    }

    function _isFinalConfiguration() private view returns (bool) {
        return SAFE.getThreshold() == 2 && SAFE.getOwners().length == 3 && _isOwner(OWNER_A)
            && _isOwner(OWNER_B) && _isOwner(OWNER_C);
    }

    function _isOwner(address candidate) private view returns (bool) {
        address[] memory owners = SAFE.getOwners();
        for (uint256 i; i < owners.length; ++i) {
            if (owners[i] == candidate) return true;
        }
        return false;
    }
}
