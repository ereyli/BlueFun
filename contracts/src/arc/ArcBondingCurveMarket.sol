// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../BondingCurveMarket.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";

/// @notice Arc-labelled Bond market. All native-value fields inherited from
///         BondingCurveMarket represent Arc native USDC, not ETH.
contract ArcBondingCurveMarket is BondingCurveMarket {
    uint8 public constant NATIVE_USDC_DECIMALS = 18;

    constructor(address initialOwner, IFeePolicy policy, IRevenueRouter router)
        BondingCurveMarket(initialOwner, policy, router)
    {}

    function arcLaunch(uint256 launchId) external view returns (LaunchState memory) {
        return launches[launchId];
    }
}
