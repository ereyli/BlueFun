// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StakingTimelock} from "../src/StakingTimelock.sol";
import {ArcDexAdapterRegistry} from "../src/arc/ArcDexAdapterRegistry.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcFeePolicy} from "../src/arc/ArcFeePolicy.sol";
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

interface VmArcV3Deploy {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the Arc v3 Direct adapter and schedules its timelocked activation.
contract DeployArcV3DirectMainnet {
    VmArcV3Deploy private constant VM =
        VmArcV3Deploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address public constant UNISWAP_V3_FACTORY = 0xf0db7b58379503491d857dB50AC9ece64c653918;
    address public constant NONFUNGIBLE_POSITION_MANAGER = 0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377;
    address public constant SWAP_ROUTER_02 = 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77;

    StakingTimelock public constant GOVERNANCE =
        StakingTimelock(payable(0x14f2Dd466A25757C7239e4417bb4924AEeAc515c));
    ArcFeePolicy public constant FEE_POLICY =
        ArcFeePolicy(0xfF134C1Ca2D2D5a9FfA4fc527f3756ba0828013B);
    ArcDexAdapterRegistry public constant ADAPTER_REGISTRY =
        ArcDexAdapterRegistry(0x55a12E8163D6a2adE6B31C0672D1636Ac03e0206);
    ArcDirectLaunchFactory public constant DIRECT_FACTORY =
        ArcDirectLaunchFactory(0x8F627E73B9175E3E5C7B320360D38271A309b2Da);

    bytes32 public constant SET_ADAPTER_SALT = keccak256("BLUEFUN_ARC_V3_DIRECT_SET_V1");
    bytes32 public constant FREEZE_ADAPTER_SALT = keccak256("BLUEFUN_ARC_V3_DIRECT_FREEZE_V1");
    bytes32 public constant UNPAUSE_SALT = keccak256("BLUEFUN_ARC_V3_DIRECT_UNPAUSE_V1");

    event ArcV3DirectDeploymentScheduled(
        address indexed deployer,
        address indexed locker,
        address indexed adapter,
        bytes32 configHash,
        bytes32 setAdapterOperation,
        bytes32 freezeAdapterOperation,
        bytes32 unpauseOperation,
        uint256 readyAt
    );

    function run() external {
        require(block.chainid == 5_042, "NOT_ARC_MAINNET");
        require(ARC_USDC.code.length != 0, "USDC_NOT_DEPLOYED");
        require(UNISWAP_V3_FACTORY.code.length != 0, "V3_FACTORY_NOT_DEPLOYED");
        require(NONFUNGIBLE_POSITION_MANAGER.code.length != 0, "POSITION_MANAGER_NOT_DEPLOYED");
        require(SWAP_ROUTER_02.code.length != 0, "SWAP_ROUTER_NOT_DEPLOYED");

        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address platformFeeRecipient = VM.envAddress("FEE_RECIPIENT");
        require(deployer == GOVERNANCE.owner(), "NOT_TIMELOCK_OWNER");
        require(ADAPTER_REGISTRY.admin() == address(GOVERNANCE), "REGISTRY_ADMIN_MISMATCH");
        require(FEE_POLICY.admin() == address(GOVERNANCE), "POLICY_ADMIN_MISMATCH");
        require(!ADAPTER_REGISTRY.directAdapterFrozen(), "DIRECT_ALREADY_FROZEN");

        VM.startBroadcast(key);
        ArcV3LiquidityLocker locker = new ArcV3LiquidityLocker(
            deployer,
            ARC_USDC,
            platformFeeRecipient,
            IStableUniswapV3Factory(UNISWAP_V3_FACTORY),
            IStableNonfungiblePositionManager(NONFUNGIBLE_POSITION_MANAGER),
            _curveConfig()
        );
        ArcV3DirectAdapter adapter = new ArcV3DirectAdapter(
            address(DIRECT_FACTORY),
            IArcNativeUSDC(ARC_USDC),
            IArcV3Factory(UNISWAP_V3_FACTORY),
            IArcV3PositionManager(NONFUNGIBLE_POSITION_MANAGER),
            IArcV3SwapRouter(SWAP_ROUTER_02),
            locker
        );
        locker.setFactory(address(adapter));
        require(adapter.isReady(), "ADAPTER_NOT_READY");

        bytes32 configHash = adapter.configHash();
        bytes memory setAdapterData =
            abi.encodeCall(ArcDexAdapterRegistry.setDirectAdapter, (address(adapter), configHash));
        bytes memory freezeAdapterData = abi.encodeCall(ArcDexAdapterRegistry.freezeDirectAdapter, ());
        bytes memory unpauseData = abi.encodeCall(ArcFeePolicy.unpauseNewLaunches, ());
        bytes32 setOperation =
            GOVERNANCE.schedule(address(ADAPTER_REGISTRY), 0, setAdapterData, SET_ADAPTER_SALT);
        bytes32 freezeOperation =
            GOVERNANCE.schedule(address(ADAPTER_REGISTRY), 0, freezeAdapterData, FREEZE_ADAPTER_SALT);
        bytes32 unpauseOperation =
            GOVERNANCE.schedule(address(FEE_POLICY), 0, unpauseData, UNPAUSE_SALT);
        VM.stopBroadcast();

        emit ArcV3DirectDeploymentScheduled(
            deployer,
            address(locker),
            address(adapter),
            configHash,
            setOperation,
            freezeOperation,
            unpauseOperation,
            block.timestamp + GOVERNANCE.delay()
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
