// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondMarketEmergencyGuardian} from "../src/BondMarketEmergencyGuardian.sol";
import {ArcBondingCurveMarket} from "../src/arc/ArcBondingCurveMarket.sol";
import {ArcBondLaunchFactory} from "../src/arc/ArcBondLaunchFactory.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
import {ArcGraduationCoordinator} from "../src/arc/ArcGraduationCoordinator.sol";
import {ArcRevenueRouter} from "../src/arc/ArcRevenueRouter.sol";
import {ArcTestnetDexAdapter} from "../src/arc/ArcTestnetDexAdapter.sol";

interface VmArcTestnet {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys and activates an isolated Arc Testnet stack for live smoke tests.
/// @dev Testnet administration is direct so setup does not wait seven days. The
///      production DeployArcMainnet script remains timelock-owned and paused.
contract DeployArcTestnet {
    VmArcTestnet private constant VM = VmArcTestnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    event ArcTestnetDeployment(
        address deployer,
        address feePolicy,
        address revenueRouter,
        address adapterRegistry,
        address testnetDexAdapter,
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
        ArcFeePolicy policy = new ArcFeePolicy(deployer, guardian);
        ArcDexAdapterRegistry registry = new ArcDexAdapterRegistry(deployer);
        ArcRevenueRouter router = new ArcRevenueRouter(deployer, policy, treasury, bridgeRecipient);
        BondMarketEmergencyGuardian emergencyGuardian = new BondMarketEmergencyGuardian();
        ArcBondingCurveMarket market = new ArcBondingCurveMarket(deployer, policy, router);
        ArcGraduationCoordinator graduation = new ArcGraduationCoordinator(market, registry);
        ArcBondLaunchFactory bondFactory =
            new ArcBondLaunchFactory(market, address(graduation), registry, policy, router);
        ArcDirectLaunchFactory directFactory = new ArcDirectLaunchFactory(registry, policy, router);
        ArcTestnetDexAdapter adapter = new ArcTestnetDexAdapter(deployer, policy, router);

        market.configure(address(bondFactory), address(graduation), address(router));
        market.transferOwnership(address(emergencyGuardian));
        adapter.configureCallers(address(graduation), address(directFactory));
        adapter.freezeCallers();
        registry.setBondAdapter(address(adapter));
        registry.setDirectAdapter(address(adapter), adapter.directConfigHash());
        registry.freezeBondAdapter();
        registry.freezeDirectAdapter();
        policy.unpauseNewLaunches();
        VM.stopBroadcast();

        emit ArcTestnetDeployment(
            deployer,
            address(policy),
            address(router),
            address(registry),
            address(adapter),
            address(market),
            address(graduation),
            address(bondFactory),
            address(directFactory)
        );
    }
}
