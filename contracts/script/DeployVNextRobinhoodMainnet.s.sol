// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FeePolicy} from "../src/FeePolicy.sol";
import {RemoteRevenueRouter} from "../src/RemoteRevenueRouter.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {Erc20LaunchFactory} from "../src/Erc20LaunchFactory.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {StakingTimelock} from "../src/StakingTimelock.sol";
import {BondMarketEmergencyGuardian} from "../src/BondMarketEmergencyGuardian.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmVNextRobinhood {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IRemoteLaunchCounter {
    function launchCount() external view returns (uint256);
}

contract DeployVNextRobinhoodMainnet {
    VmVNextRobinhood private constant VM =
        VmVNextRobinhood(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address private constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address private constant PREVIOUS_MARKET = 0x2D6D77652FACbbcAE05C0DC3aEd792B94Cd61FA8;
    address private constant PREVIOUS_DIRECT_FACTORY = 0x9d0e5D76ca2d79CA6aB0C800763eB8e5C39A5079;
    uint24 private constant DYNAMIC_FEE = 0x800000;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    event VNextRobinhoodDeployment(
        address governance,
        address feePolicy,
        address revenueRouter,
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
        address bridgeRecipient = VM.envAddress("BRIDGE_RECIPIENT");
        uint256 bondSeed = IRemoteLaunchCounter(PREVIOUS_MARKET).launchCount();
        uint256 directSeed = IRemoteLaunchCounter(PREVIOUS_DIRECT_FACTORY).launchCount();

        VM.startBroadcast(key);
        StakingTimelock governance = new StakingTimelock(deployer, guardian, 7 days);
        FeePolicy policy = new FeePolicy(address(governance), guardian);
        RemoteRevenueRouter router =
            new RemoteRevenueRouter(address(governance), policy, treasury, bridgeRecipient);
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
        Erc20GraduationManager graduation = new Erc20GraduationManager(market, bondLocker);
        bondLocker.setGraduationManager(address(graduation));
        Erc20LaunchFactory factory =
            new Erc20LaunchFactory(deployer, market, address(graduation), policy, router);
        market.configure(address(factory), address(graduation), address(router));

        DirectDexLiquidityLocker directLocker = new DirectDexLiquidityLocker(
            deployer,
            address(router),
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(address(hook))
        );
        DirectErc20LaunchFactory directFactory =
            new DirectErc20LaunchFactory(deployer, directLocker, policy, router, _directConfig());
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

        emit VNextRobinhoodDeployment(
            address(governance),
            address(policy),
            address(router),
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

    function _deployHook(address deployer, FeePolicy policy, RemoteRevenueRouter router)
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
