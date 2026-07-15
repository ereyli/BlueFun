// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IB20Factory} from "../src/interfaces/IB20Factory.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {FeePolicy} from "../src/FeePolicy.sol";
import {BaseRevenueRouterV2} from "../src/BaseRevenueRouterV2.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {GraduationManager} from "../src/GraduationManager.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {DirectB20LaunchFactory} from "../src/DirectB20LaunchFactory.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {StakingTimelock} from "../src/StakingTimelock.sol";
import {BondMarketEmergencyGuardian} from "../src/BondMarketEmergencyGuardian.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmVNextBase {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface ILaunchCounter {
    function launchCount() external view returns (uint256);
}

contract DeployVNextBaseMainnet {
    VmVNextBase private constant VM = VmVNextBase(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address private constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address private constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address private constant BLUE = 0xb200000000000000000000Af2d07754b927109bc;
    address private constant PREVIOUS_MARKET = 0xb503B0ef06ec10554F4d960e08869877A41498dd;
    address private constant PREVIOUS_DIRECT_FACTORY = 0x0246688cEF66734c1CADa909CFD202E1448ba275;
    uint24 private constant DYNAMIC_FEE = 0x800000;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    event VNextBaseDeployment(
        address governance,
        address feePolicy,
        address revenueRouter,
        address stakingVault,
        address feeHook,
        address market,
        address graduationManager,
        address bondLocker,
        address bondFactory,
        address directLocker,
        address directFactory
    );

    function run() external {
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address treasury = VM.envAddress("FEE_RECIPIENT");
        address guardian = VM.envAddress("GOVERNANCE_GUARDIAN");

        uint256 bondSeed = ILaunchCounter(PREVIOUS_MARKET).launchCount();
        uint256 directSeed = ILaunchCounter(PREVIOUS_DIRECT_FACTORY).launchCount();

        VM.startBroadcast(key);
        StakingTimelock governance = new StakingTimelock(deployer, guardian, 7 days);
        FeePolicy policy = new FeePolicy(address(governance), guardian);
        BaseRevenueRouterV2 router = new BaseRevenueRouterV2(
            BLUE, address(governance), guardian, policy, treasury, 7 days, 30 days
        );
        UnifiedFeeHook hook = _deployHook(deployer, policy, router);
        BondMarketEmergencyGuardian emergencyGuardian = new BondMarketEmergencyGuardian();

        BondingCurveMarket market = new BondingCurveMarket(deployer, policy, router);
        if (bondSeed != 0) market.seedLaunchCount(bondSeed);
        UniswapV4LiquidityLocker bondLocker = new UniswapV4LiquidityLocker(
            deployer,
            address(router),
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            DYNAMIC_FEE,
            60,
            address(hook)
        );
        GraduationManager graduation =
            new GraduationManager(market, bondLocker, IPolicyRegistry(B20Constants.POLICY_REGISTRY));
        bondLocker.setGraduationManager(address(graduation));
        LaunchFactory factory = new LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            market,
            address(graduation),
            policy,
            router
        );
        market.configure(address(factory), address(graduation), address(router));

        DirectDexLiquidityLocker directLocker = new DirectDexLiquidityLocker(
            deployer,
            address(router),
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(address(hook))
        );
        DirectB20LaunchFactory directFactory = new DirectB20LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            directLocker,
            policy,
            router,
            _directConfig()
        );
        if (directSeed != 0) directFactory.seedLaunchCount(directSeed);
        directFactory.setLaunchRouter(UNIVERSAL_ROUTER);
        directLocker.setFactory(address(directFactory));

        address[] memory lockers = new address[](2);
        lockers[0] = address(bondLocker);
        lockers[1] = address(directLocker);
        hook.configureLockers(lockers);
        factory.transferOwnership(address(governance));
        directFactory.transferOwnership(address(governance));
        market.transferOwnership(address(emergencyGuardian));
        VM.stopBroadcast();

        emit VNextBaseDeployment(
            address(governance),
            address(policy),
            address(router),
            address(router.vault()),
            address(hook),
            address(market),
            address(graduation),
            address(bondLocker),
            address(factory),
            address(directLocker),
            address(directFactory)
        );
    }

    function _directConfig() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: DYNAMIC_FEE,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            initialSqrtPriceX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 10_000,
            creatorShareBps: 0
        });
    }

    function _deployHook(address deployer, FeePolicy policy, BaseRevenueRouterV2 router)
        private
        returns (UnifiedFeeHook hook)
    {
        bytes memory initCode = abi.encodePacked(
            type(UnifiedFeeHook).creationCode, abi.encode(deployer, POOL_MANAGER, policy, router)
        );
        bytes32 hash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, hash))))
            );
            if ((uint160(predicted) & ALL_HOOK_MASK) == HOOK_FLAGS) break;
        }
        require(predicted.code.length == 0, "HOOK_ALREADY_DEPLOYED");
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && predicted.code.length != 0, "HOOK_DEPLOY_FAILED");
        return UnifiedFeeHook(payable(predicted));
    }
}
