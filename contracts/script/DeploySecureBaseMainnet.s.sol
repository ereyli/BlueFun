// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IB20Factory} from "../src/interfaces/IB20Factory.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {GraduationManager} from "../src/GraduationManager.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {DirectB20LaunchFactory} from "../src/DirectB20LaunchFactory.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {LaunchPoolInitializationHook} from "../src/LaunchPoolInitializationHook.sol";
import {TimelockedAdmin} from "../src/TimelockedAdmin.sol";
import {BondMarketEmergencyGuardian} from "../src/BondMarketEmergencyGuardian.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmSecureBase {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IOwnableDeployment {
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
}

contract DeploySecureBaseMainnet {
    VmSecureBase internal constant vm = VmSecureBase(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant GOVERNANCE_GUARDIAN = 0xd5bc4D80797ddAEBd91282659Eb79ABaf659B47C;
    uint160 internal constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    uint160 internal constant ALL_HOOK_MASK = (1 << 14) - 1;

    address internal constant LEGACY_MARKET = 0x4CE2154146eAcf745133D7755875767d6a00Ee5f;
    address internal constant LEGACY_FACTORY = 0xf65EBFdaCB1A8e0A8217185AAE44F489e53B88f9;
    address internal constant PREVIOUS_MARKET = 0x94D056Be6573Bcaa4958cceeB242C3c08EFF2B95;
    address internal constant PREVIOUS_FACTORY = 0x29ce28c9cb3F584EB2548883824ACD49881e780A;
    address internal constant PREVIOUS_DIRECT_FACTORY = 0xe4E8fd53d961566BD3A9C6f41e7f30AF9952f1c5;

    event SecureDeployment(
        address governance,
        address emergencyGuardian,
        address initializationHook,
        address bondingCurveMarket,
        address graduationManager,
        address liquidityLocker,
        address launchFactory,
        address directLiquidityLocker,
        address directLaunchFactory,
        address feeRecipient
    );

    function run() external {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast(privateKey);
        TimelockedAdmin governance = new TimelockedAdmin(deployer, GOVERNANCE_GUARDIAN, 48 hours);
        BondMarketEmergencyGuardian emergencyGuardian = new BondMarketEmergencyGuardian();
        LaunchPoolInitializationHook hook = _deployHook(deployer);

        BondingCurveMarket market = new BondingCurveMarket(deployer, feeRecipient);
        market.seedLaunchCount(22);
        UniswapV4LiquidityLocker locker = new UniswapV4LiquidityLocker(
            deployer,
            feeRecipient,
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            3_000,
            60,
            address(hook)
        );
        GraduationManager graduation = new GraduationManager(
            market, locker, IPolicyRegistry(B20Constants.POLICY_REGISTRY)
        );
        locker.setGraduationManager(address(graduation));
        LaunchFactory factory = new LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            market,
            address(graduation),
            payable(feeRecipient)
        );
        market.configure(address(factory), address(graduation), feeRecipient);

        DirectDexLiquidityLocker directLocker = new DirectDexLiquidityLocker(
            deployer,
            feeRecipient,
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
            payable(feeRecipient),
            _directConfig(),
            0.002 ether
        );
        directLocker.setFactory(address(directFactory));

        address[] memory lockers = new address[](2);
        lockers[0] = address(locker);
        lockers[1] = address(directLocker);
        hook.configureLockers(lockers);

        factory.transferOwnership(address(governance));
        directFactory.transferOwnership(address(governance));
        market.transferOwnership(address(emergencyGuardian));
        _securePreviousDeployment(deployer, governance, emergencyGuardian);
        vm.stopBroadcast();

        emit SecureDeployment(
            address(governance),
            address(emergencyGuardian),
            address(hook),
            address(market),
            address(graduation),
            address(locker),
            address(factory),
            address(directLocker),
            address(directFactory),
            feeRecipient
        );
    }

    function _directConfig() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 10_000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            initialSqrtPriceX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }

    function _deployHook(address deployer) private returns (LaunchPoolInitializationHook hook) {
        bytes memory initCode = abi.encodePacked(
            type(LaunchPoolInitializationHook).creationCode, abi.encode(deployer, POOL_MANAGER)
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash)))));
            if ((uint160(predicted) & ALL_HOOK_MASK) == BEFORE_INITIALIZE_FLAG) break;
        }
        if (predicted.code.length == 0) {
            (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
            require(ok && predicted.code.length > 0, "HOOK_DEPLOY_FAILED");
        }
        return LaunchPoolInitializationHook(predicted);
    }

    function _securePreviousDeployment(
        address deployer,
        TimelockedAdmin governance,
        BondMarketEmergencyGuardian emergencyGuardian
    ) private {
        _transferIfOwned(LEGACY_MARKET, deployer, address(emergencyGuardian));
        _transferIfOwned(PREVIOUS_MARKET, deployer, address(emergencyGuardian));
        _transferIfOwned(LEGACY_FACTORY, deployer, address(governance));
        _transferIfOwned(PREVIOUS_FACTORY, deployer, address(governance));
        _transferIfOwned(PREVIOUS_DIRECT_FACTORY, deployer, address(governance));
    }

    function _transferIfOwned(address target, address expectedOwner, address newOwner) private {
        if (IOwnableDeployment(target).owner() == expectedOwner) {
            IOwnableDeployment(target).transferOwnership(newOwner);
        }
    }
}
