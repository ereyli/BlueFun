// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StakingTimelock} from "../src/StakingTimelock.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";

interface VmArcV3Execute {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Executes the three pre-scheduled Arc Direct activation operations.
contract ExecuteArcV3DirectActivation {
    VmArcV3Execute private constant VM =
        VmArcV3Execute(address(uint160(uint256(keccak256("hevm cheat code")))));

    StakingTimelock private constant GOVERNANCE =
        StakingTimelock(payable(0x14f2Dd466A25757C7239e4417bb4924AEeAc515c));
    ArcFeePolicy private constant FEE_POLICY =
        ArcFeePolicy(0xfF134C1Ca2D2D5a9FfA4fc527f3756ba0828013B);
    ArcDexAdapterRegistry private constant ADAPTER_REGISTRY =
        ArcDexAdapterRegistry(0x55a12E8163D6a2adE6B31C0672D1636Ac03e0206);

    bytes32 private constant SET_ADAPTER_SALT = keccak256("BLUEFUN_ARC_V3_DIRECT_SET_V1");
    bytes32 private constant FREEZE_ADAPTER_SALT = keccak256("BLUEFUN_ARC_V3_DIRECT_FREEZE_V1");
    bytes32 private constant UNPAUSE_SALT = keccak256("BLUEFUN_ARC_V3_DIRECT_UNPAUSE_V1");

    function run() external {
        require(block.chainid == 5_042, "NOT_ARC_MAINNET");
        address adapter = VM.envAddress("ARC_V3_DIRECT_ADAPTER");
        bytes32 configHash = bytes32(VM.envUint("ARC_V3_DIRECT_CONFIG_HASH"));

        bytes memory setAdapterData =
            abi.encodeCall(ArcDexAdapterRegistry.setDirectAdapter, (adapter, configHash));
        bytes memory freezeAdapterData = abi.encodeCall(ArcDexAdapterRegistry.freezeDirectAdapter, ());
        bytes memory unpauseData = abi.encodeCall(ArcFeePolicy.unpauseNewLaunches, ());

        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        VM.startBroadcast(key);
        GOVERNANCE.execute(address(ADAPTER_REGISTRY), 0, setAdapterData, SET_ADAPTER_SALT);
        GOVERNANCE.execute(address(ADAPTER_REGISTRY), 0, freezeAdapterData, FREEZE_ADAPTER_SALT);
        GOVERNANCE.execute(address(FEE_POLICY), 0, unpauseData, UNPAUSE_SALT);
        VM.stopBroadcast();

        require(ADAPTER_REGISTRY.directAdapter() == adapter, "ADAPTER_MISMATCH");
        require(ADAPTER_REGISTRY.directConfigHash() == configHash, "CONFIG_MISMATCH");
        require(ADAPTER_REGISTRY.directAdapterFrozen(), "ADAPTER_NOT_FROZEN");
        require(!FEE_POLICY.newLaunchesPaused(), "LAUNCHES_STILL_PAUSED");
    }
}
