// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface ILegacyEmergencyMarket {
    function cancelEmergencyClose(uint256 launchId) external;
}

/// @notice Permanent owner sink for configured Bond markets.
/// @dev It cannot schedule or execute a reserve withdrawal. Anyone may cancel a legacy schedule.
contract BondMarketEmergencyGuardian {
    function cancelLegacySchedule(ILegacyEmergencyMarket market, uint256 launchId) external {
        market.cancelEmergencyClose(launchId);
    }
}
