// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "../access/TwoStepAdmin.sol";
import {IArcDexAdapterStatus} from "./IArcDexAdapter.sol";

/// @notice Timelock-owned staging registry for Arc DEX integrations.
/// @dev Adapters can be corrected while launch creation is paused. Once an
///      adapter is frozen it can never be replaced in this contract generation.
contract ArcDexAdapterRegistry is TwoStepAdmin {
    error InvalidAdapter();
    error AdapterFrozen();
    error AdapterNotConfigured();
    error AdapterNotReady();
    error InvalidConfigHash();

    address public bondAdapter;
    address public directAdapter;
    bytes32 public directConfigHash;
    bool public bondAdapterFrozen;
    bool public directAdapterFrozen;

    event BondAdapterUpdated(address indexed previousAdapter, address indexed newAdapter);
    event DirectAdapterUpdated(address indexed previousAdapter, address indexed newAdapter, bytes32 indexed configHash);
    event BondAdapterFrozen(address indexed adapter);
    event DirectAdapterFrozen(address indexed adapter, bytes32 indexed configHash);

    constructor(address admin_) TwoStepAdmin(admin_) {}

    function setBondAdapter(address adapter) external onlyAdmin {
        if (bondAdapterFrozen) revert AdapterFrozen();
        _validateAdapter(adapter);
        emit BondAdapterUpdated(bondAdapter, adapter);
        bondAdapter = adapter;
    }

    function setDirectAdapter(address adapter, bytes32 configHash) external onlyAdmin {
        if (directAdapterFrozen) revert AdapterFrozen();
        if (configHash == bytes32(0)) revert InvalidConfigHash();
        _validateAdapter(adapter);
        emit DirectAdapterUpdated(directAdapter, adapter, configHash);
        directAdapter = adapter;
        directConfigHash = configHash;
    }

    function freezeBondAdapter() external onlyAdmin {
        address adapter = bondAdapter;
        if (bondAdapterFrozen) revert AdapterFrozen();
        if (adapter == address(0)) revert AdapterNotConfigured();
        if (!IArcDexAdapterStatus(adapter).isReady()) revert AdapterNotReady();
        bondAdapterFrozen = true;
        emit BondAdapterFrozen(adapter);
    }

    function freezeDirectAdapter() external onlyAdmin {
        address adapter = directAdapter;
        if (directAdapterFrozen) revert AdapterFrozen();
        if (adapter == address(0)) revert AdapterNotConfigured();
        if (directConfigHash == bytes32(0)) revert InvalidConfigHash();
        if (!IArcDexAdapterStatus(adapter).isReady()) revert AdapterNotReady();
        directAdapterFrozen = true;
        emit DirectAdapterFrozen(adapter, directConfigHash);
    }

    function _validateAdapter(address adapter) private view {
        if (adapter == address(0) || adapter.code.length == 0) revert InvalidAdapter();
    }
}
