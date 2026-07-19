// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../BondingCurveMarket.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {ArcDexAdapterRegistry} from "./ArcDexAdapterRegistry.sol";
import {IArcBondDexAdapter} from "./IArcDexAdapter.sol";

/// @notice Graduates Arc Bond launches through the permanently frozen adapter.
contract ArcGraduationCoordinator is ReentrancyGuard {
    error NotReady();
    error AlreadyGraduated();
    error NoLiquidity();
    error AdapterNotFrozen();
    error AdapterNotReady();
    error InvalidPosition();

    BondingCurveMarket public immutable market;
    ArcDexAdapterRegistry public immutable adapterRegistry;

    event ArcBondGraduated(
        uint256 indexed launchId,
        address indexed token,
        address indexed adapter,
        uint256 usdcAmount,
        uint256 tokenAmount,
        bytes32 positionId
    );

    constructor(BondingCurveMarket market_, ArcDexAdapterRegistry adapterRegistry_) {
        market = market_;
        adapterRegistry = adapterRegistry_;
    }

    receive() external payable {}

    function graduate(uint256 launchId) external nonReentrant returns (bytes32 positionId) {
        if (!adapterRegistry.bondAdapterFrozen()) revert AdapterNotFrozen();
        address adapterAddress = adapterRegistry.bondAdapter();
        IArcBondDexAdapter adapter = IArcBondDexAdapter(adapterAddress);
        if (!adapter.isReady()) revert AdapterNotReady();

        (address token, address creator, uint256 usdcAmount, uint256 tokenAmount,) =
            market.graduationLiquidity(launchId);
        (,,,,,,,,,,,,,,, bool graduationReady, bool graduated) = market.launches(launchId);
        if (!graduationReady) revert NotReady();
        if (graduated) revert AlreadyGraduated();
        if (usdcAmount == 0 || tokenAmount == 0) revert NoLiquidity();

        market.withdrawGraduationTokens(launchId, adapterAddress, tokenAmount);
        uint256 withdrawn = market.withdrawGraduationEth(launchId, payable(address(this)));
        positionId = adapter.lockBondLiquidity{value: withdrawn}(launchId, token, tokenAmount, creator);
        if (positionId == bytes32(0)) revert InvalidPosition();
        market.markGraduated(launchId);
        emit ArcBondGraduated(launchId, token, adapterAddress, withdrawn, tokenAmount, positionId);
    }
}
