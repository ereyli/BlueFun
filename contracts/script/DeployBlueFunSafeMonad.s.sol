// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface VmBlueFunSafeMonad {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface ISafeProxyFactoryMonad {
    function createProxyWithNonce(address singleton, bytes calldata initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @notice Reproduces the existing BlueFun 2-of-3 Safe's counterfactual address on Monad.
/// @dev The exact initializer and salt are preserved from the Base/Robinhood deployment.
///      After creation, the existing signer set completes the same add-owner/threshold setup.
contract DeployBlueFunSafeMonad {
    VmBlueFunSafeMonad private constant VM =
        VmBlueFunSafeMonad(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address private constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address public constant EXPECTED_SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;

    bytes private constant INITIALIZER = hex"b63e800d00000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000bd89a1ce4dde368ffab0ec35506eece0b1ffdc540000000000000000000000000000000000000000000000000000000000000140000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005afe7a11e70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a7a9b7e0c4b36d9de8a94c6388449d06f2c5952f0000000000000000000000000000000000000000000000000000000000000024fe51f64300000000000000000000000029fcb43b46531bca003ddc8fcb67ffe91900c76200000000000000000000000000000000000000000000000000000000";

    event BlueFunSafeDeployed(address indexed safe);

    function run() external returns (address safe) {
        if (EXPECTED_SAFE.code.length != 0) return EXPECTED_SAFE;
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        VM.startBroadcast(key);
        safe = ISafeProxyFactoryMonad(SAFE_PROXY_FACTORY).createProxyWithNonce(
            SAFE_SINGLETON, INITIALIZER, 0
        );
        VM.stopBroadcast();
        require(safe == EXPECTED_SAFE && safe.code.length != 0, "UNEXPECTED_SAFE");
        emit BlueFunSafeDeployed(safe);
    }
}
