// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StakingTimelock} from "../src/StakingTimelock.sol";
import {BondMarketEmergencyGuardian} from "../src/BondMarketEmergencyGuardian.sol";
import {ArcBondingCurveMarket} from "../src/arc/ArcBondingCurveMarket.sol";
import {ArcBondLaunchFactory} from "../src/arc/ArcBondLaunchFactory.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
import {ArcGraduationCoordinator} from "../src/arc/ArcGraduationCoordinator.sol";
import {ArcRevenueRouter} from "../src/arc/ArcRevenueRouter.sol";

interface VmArcMainnet {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the DEX-independent Arc core in a launch-paused state.
/// @dev Uniswap contracts are deliberately not accepted by this script. A
///      separately reviewed adapter must later be staged and frozen through the
///      seven-day timelock before either factory can create a token.
contract DeployArcMainnet {
    VmArcMainnet private constant VM = VmArcMainnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    event ArcCoreDeployment(
        address deployer,
        address governance,
        address feePolicy,
        address revenueRouter,
        address adapterRegistry,
        address emergencyGuardian,
        address bondingCurveMarket,
        address graduationCoordinator,
        address bondFactory,
        address directFactory
    );

    function run() external {
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address treasury = VM.envAddress("FEE_RECIPIENT");
        address guardian = VM.envAddress("GOVERNANCE_GUARDIAN");
        address bridgeRecipient = VM.envAddress("BRIDGE_RECIPIENT");

        VM.startBroadcast(key);
        StakingTimelock governance = new StakingTimelock(deployer, guardian, 7 days);
        ArcFeePolicy policy = new ArcFeePolicy(address(governance), guardian);
        ArcDexAdapterRegistry registry = new ArcDexAdapterRegistry(address(governance));
        ArcRevenueRouter router = new ArcRevenueRouter(address(governance), policy, treasury, bridgeRecipient);
        BondMarketEmergencyGuardian emergencyGuardian = new BondMarketEmergencyGuardian();
        ArcBondingCurveMarket market = new ArcBondingCurveMarket(deployer, policy, router);
        ArcGraduationCoordinator graduation = new ArcGraduationCoordinator(market, registry);
        ArcBondLaunchFactory bondFactory =
            new ArcBondLaunchFactory(market, address(graduation), registry, policy, router);
        ArcDirectLaunchFactory directFactory = new ArcDirectLaunchFactory(registry, policy, router);
        market.configure(address(bondFactory), address(graduation), address(router));
        market.transferOwnership(address(emergencyGuardian));
        VM.stopBroadcast();

        emit ArcCoreDeployment(
            deployer,
            address(governance),
            address(policy),
            address(router),
            address(registry),
            address(emergencyGuardian),
            address(market),
            address(graduation),
            address(bondFactory),
            address(directFactory)
        );
    }
}
