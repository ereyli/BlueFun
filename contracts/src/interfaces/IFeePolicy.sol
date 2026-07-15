// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IFeePolicy {
    function buyPlatformFeeBps() external view returns (uint16);
    function buyCreatorFeeBps() external view returns (uint16);
    function sellPlatformFeeBps() external view returns (uint16);
    function sellBurnFeeBps() external view returns (uint16);
    function launchFee() external view returns (uint256);
    function tradeStakingShareBps() external view returns (uint16);
    function launchStakingShareBps() external view returns (uint16);
    function newLaunchesPaused() external view returns (bool);
}
