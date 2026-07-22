// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {MonadFeePolicy} from "../src/monad/MonadFeePolicy.sol";
import {MonadRevenueRouter} from "../src/monad/MonadRevenueRouter.sol";
import {MonadLaunchFactory} from "../src/monad/MonadLaunchFactory.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
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

interface VmVNextMonad {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IConfiguredBlueFunSafe {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

contract DeployVNextMonadMainnet {
    VmVNextMonad private constant VM = VmVNextMonad(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant BLUEFUN_SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant POOL_MANAGER = 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e;
    address private constant POSITION_MANAGER = 0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016;
    address private constant STATE_VIEW = 0x77395F3b2E73aE90843717371294fa97cC419D64;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant UNIVERSAL_ROUTER = 0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7;

    uint256 public constant INITIAL_LAUNCH_FEE = 80 ether;
    uint24 private constant DYNAMIC_FEE = 0x800000;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    event VNextMonadDeployment(
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
        require(block.chainid == 143, "NOT_MONAD_MAINNET");
        require(BLUEFUN_SAFE.code.length != 0, "SAFE_NOT_DEPLOYED");
        require(IConfiguredBlueFunSafe(BLUEFUN_SAFE).getThreshold() == 2, "SAFE_THRESHOLD_NOT_TWO");
        require(IConfiguredBlueFunSafe(BLUEFUN_SAFE).getOwners().length == 3, "SAFE_OWNER_COUNT_NOT_THREE");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address guardian = VM.envAddress("GOVERNANCE_GUARDIAN");
        require(guardian != BLUEFUN_SAFE && guardian != address(0), "INVALID_GUARDIAN");

        VM.startBroadcast(key);
        StakingTimelock governance = new StakingTimelock(BLUEFUN_SAFE, guardian, 7 days);
        MonadFeePolicy policy = new MonadFeePolicy(address(governance), guardian, INITIAL_LAUNCH_FEE);
        MonadRevenueRouter router = new MonadRevenueRouter(address(governance), BLUEFUN_SAFE);
        UnifiedFeeHook hook = _deployHook(deployer, policy, router);
        BondMarketEmergencyGuardian emergencyGuardian = new BondMarketEmergencyGuardian();

        BondingCurveMarket market = new BondingCurveMarket(deployer, policy, router);
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
        MonadLaunchFactory factory =
            new MonadLaunchFactory(deployer, market, address(graduation), policy, router);
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

        emit VNextMonadDeployment(
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
            tickUpper: 86_000,
            // Approximately 700 MON initial FDV for a one-billion-token supply.
            initialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630,
            platformShareBps: 10_000,
            creatorShareBps: 0
        });
    }

    function _deployHook(address deployer, MonadFeePolicy policy, MonadRevenueRouter router)
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
