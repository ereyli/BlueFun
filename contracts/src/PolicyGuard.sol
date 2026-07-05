// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20} from "./interfaces/IB20.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {B20Constants} from "./libraries/B20Constants.sol";

abstract contract PolicyGuard {
    error PolicyDoesNotExist(uint64 policyId);

    IPolicyRegistry public immutable policyRegistry;

    constructor(IPolicyRegistry policyRegistry_) {
        policyRegistry = policyRegistry_;
    }

    function _validatePolicyId(uint64 policyId) internal view {
        if (policyId == B20Constants.ALWAYS_ALLOW || policyId == B20Constants.ALWAYS_BLOCK) return;
        if (!policyRegistry.policyExists(policyId)) revert PolicyDoesNotExist(policyId);
    }

    function _openTransferPolicies(address token) internal {
        IB20 b20 = IB20(token);
        b20.updatePolicy(b20.TRANSFER_SENDER_POLICY(), B20Constants.ALWAYS_ALLOW);
        b20.updatePolicy(b20.TRANSFER_RECEIVER_POLICY(), B20Constants.ALWAYS_ALLOW);
        b20.updatePolicy(b20.TRANSFER_EXECUTOR_POLICY(), B20Constants.ALWAYS_ALLOW);
    }
}

