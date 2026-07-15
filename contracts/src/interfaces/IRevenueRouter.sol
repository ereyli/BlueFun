// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IRevenueRouter {
    function depositTradeRevenue() external payable;
    function depositLaunchRevenue() external payable;
}
