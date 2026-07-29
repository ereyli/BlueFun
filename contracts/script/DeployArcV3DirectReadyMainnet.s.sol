// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StakingTimelock} from "../src/StakingTimelock.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
import {ArcRevenueRouter} from "../src/arc/ArcRevenueRouter.sol";
import {ArcV3DirectAdapter} from "../src/arc/ArcV3DirectAdapter.sol";
import {ArcV3LiquidityLocker} from "../src/arc/ArcV3LiquidityLocker.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";
import {
    IArcNativeUSDC,
    IArcV3Factory,
    IArcV3PositionManager,
    IArcV3SwapRouter
} from "../src/arc/ArcV3Interfaces.sol";
import {
    IStableNonfungiblePositionManager,
    IStableUniswapV3Factory
} from "../src/stable/StableUniswapV3Interfaces.sol";

interface VmArcReadyDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys an immediately launch-ready Arc Direct generation.
/// @dev Adapter selection is frozen before launches are unpaused. Administration
///      starts at the deployer only for bootstrap and is proposed to the existing
///      seven-day governance timelock in the same transaction group.
contract DeployArcV3DirectReadyMainnet {
    VmArcReadyDeploy private constant VM =
        VmArcReadyDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address public constant UNISWAP_V3_FACTORY = 0xf0db7b58379503491d857dB50AC9ece64c653918;
    address public constant NONFUNGIBLE_POSITION_MANAGER = 0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377;
    address public constant SWAP_ROUTER_02 = 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77;
    StakingTimelock public constant GOVERNANCE =
        StakingTimelock(payable(0x14f2Dd466A25757C7239e4417bb4924AEeAc515c));

    bytes32 private constant POLICY_ACCEPT_SALT = keccak256("BLUEFUN_ARC_READY_POLICY_ACCEPT_V1");
    bytes32 private constant REGISTRY_ACCEPT_SALT = keccak256("BLUEFUN_ARC_READY_REGISTRY_ACCEPT_V1");
    bytes32 private constant ROUTER_ACCEPT_SALT = keccak256("BLUEFUN_ARC_READY_ROUTER_ACCEPT_V1");

    event ArcDirectReadyDeployment(
        address indexed deployer,
        address indexed directFactory,
        address indexed adapter,
        address feePolicy,
        address revenueRouter,
        address adapterRegistry,
        address liquidityLocker,
        bytes32 configHash,
        bytes32 policyAcceptOperation,
        bytes32 registryAcceptOperation,
        bytes32 routerAcceptOperation
    );

    function run() external {
        require(block.chainid == 5_042, "NOT_ARC_MAINNET");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address treasury = VM.envAddress("FEE_RECIPIENT");
        address guardian = VM.envAddress("GOVERNANCE_GUARDIAN");
        address bridgeRecipient = VM.envAddress("BRIDGE_RECIPIENT");
        require(deployer == GOVERNANCE.owner(), "NOT_TIMELOCK_OWNER");

        VM.startBroadcast(key);
        ArcFeePolicy policy = new ArcFeePolicy(deployer, guardian);
        ArcDexAdapterRegistry registry = new ArcDexAdapterRegistry(deployer);
        ArcRevenueRouter revenueRouter =
            new ArcRevenueRouter(deployer, policy, treasury, bridgeRecipient);
        ArcDirectLaunchFactory directFactory =
            new ArcDirectLaunchFactory(registry, policy, revenueRouter);
        ArcV3LiquidityLocker locker = new ArcV3LiquidityLocker(
            deployer,
            ARC_USDC,
            treasury,
            IStableUniswapV3Factory(UNISWAP_V3_FACTORY),
            IStableNonfungiblePositionManager(NONFUNGIBLE_POSITION_MANAGER),
            _curveConfig()
        );
        ArcV3DirectAdapter adapter = new ArcV3DirectAdapter(
            address(directFactory),
            IArcNativeUSDC(ARC_USDC),
            IArcV3Factory(UNISWAP_V3_FACTORY),
            IArcV3PositionManager(NONFUNGIBLE_POSITION_MANAGER),
            IArcV3SwapRouter(SWAP_ROUTER_02),
            locker
        );
        locker.setFactory(address(adapter));
        require(adapter.isReady(), "ADAPTER_NOT_READY");
        registry.setDirectAdapter(address(adapter), adapter.configHash());
        registry.freezeDirectAdapter();
        policy.unpauseNewLaunches();

        policy.proposeAdmin(address(GOVERNANCE));
        registry.proposeAdmin(address(GOVERNANCE));
        revenueRouter.proposeAdmin(address(GOVERNANCE));
        bytes memory acceptAdminData = abi.encodeWithSignature("acceptAdmin()");
        bytes32 policyOperation =
            GOVERNANCE.schedule(address(policy), 0, acceptAdminData, POLICY_ACCEPT_SALT);
        bytes32 registryOperation =
            GOVERNANCE.schedule(address(registry), 0, acceptAdminData, REGISTRY_ACCEPT_SALT);
        bytes32 routerOperation =
            GOVERNANCE.schedule(address(revenueRouter), 0, acceptAdminData, ROUTER_ACCEPT_SALT);
        VM.stopBroadcast();

        require(!policy.newLaunchesPaused(), "LAUNCHES_PAUSED");
        require(registry.directAdapterFrozen(), "ADAPTER_NOT_FROZEN");
        emit ArcDirectReadyDeployment(
            deployer,
            address(directFactory),
            address(adapter),
            address(policy),
            address(revenueRouter),
            address(registry),
            address(locker),
            adapter.configHash(),
            policyOperation,
            registryOperation,
            routerOperation
        );
    }

    function _curveConfig() private pure returns (StableV3LiquidityLocker.CurveConfig memory) {
        return StableV3LiquidityLocker.CurveConfig({
            canonicalTickLower: -572_600,
            canonicalTickUpper: 400_600,
            canonicalInitialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630_000_000
        });
    }
}
