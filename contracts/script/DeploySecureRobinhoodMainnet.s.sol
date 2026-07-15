// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {Erc20LaunchFactory} from "../src/Erc20LaunchFactory.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
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

interface VmSecureRobinhood {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IOwnableRobinhoodDeployment {
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
}

contract DeploySecureRobinhoodMainnet {
    VmSecureRobinhood internal constant vm =
        VmSecureRobinhood(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant GOVERNANCE_GUARDIAN = 0x9d5f55a644eF0eB9FF82dbd14Dd0471de3ff5bfb;
    uint160 internal constant BEFORE_INITIALIZE_FLAG = 1 << 13;
    uint160 internal constant ALL_HOOK_MASK = (1 << 14) - 1;

    address internal constant LEGACY_MARKET = 0xAb7597fECAf3357101a3a4331F512031ef3238F0;
    address internal constant LEGACY_FACTORY = 0x6A05304638Bed7c96b78F420c612E84111FaD4d1;
    address internal constant PREVIOUS_MARKET = 0x795Fe5649A78496f51c1594A7B435941fb20adb8;
    address internal constant PREVIOUS_FACTORY = 0x128a32eD2af1787a3fAB261bc6158400e2F649c9;
    address internal constant PREVIOUS_DIRECT_FACTORY = 0xDE6414a1140f97b4de63462608af79f7b1Bbc393;

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
        market.seedLaunchCount(1);
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
        Erc20GraduationManager graduation = new Erc20GraduationManager(market, locker);
        locker.setGraduationManager(address(graduation));
        Erc20LaunchFactory factory =
            new Erc20LaunchFactory(deployer, market, address(graduation), payable(feeRecipient));
        market.configure(address(factory), address(graduation), feeRecipient);

        DirectDexLiquidityLocker directLocker = new DirectDexLiquidityLocker(
            deployer,
            feeRecipient,
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(address(hook))
        );
        DirectErc20LaunchFactory directFactory = new DirectErc20LaunchFactory(
            deployer, directLocker, payable(feeRecipient), _directConfig(), 0.002 ether
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
        if (IOwnableRobinhoodDeployment(target).owner() == expectedOwner) {
            IOwnableRobinhoodDeployment(target).transferOwnership(newOwner);
        }
    }
}
