// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20Minimal} from "../src/UniswapV4LiquidityLocker.sol";
import {StakingTimelock} from "../src/StakingTimelock.sol";
import {StableFeePolicy} from "../src/stable/StableFeePolicy.sol";
import {StableRevenueRouter} from "../src/stable/StableRevenueRouter.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";
import {IStableUSDT0, StableV3DirectLaunchFactory} from "../src/stable/StableV3DirectLaunchFactory.sol";
import {
    IStableNonfungiblePositionManager,
    IStableSwapRouter02,
    IStableUniswapV3Factory
} from "../src/stable/StableUniswapV3Interfaces.sol";

interface VmStableDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys Stable Direct with temporary deployer-owned governance.
/// @dev The timelock owner must be transferred to BLUEFUN_SAFE after the Safe is deployed and verified on chain.
contract DeployStableDirectMainnet {
    VmStableDeploy private constant VM = VmStableDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant BLUEFUN_SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant UNISWAP_V3_FACTORY = 0x88F0a512eF09175D456bc9547f914f48C013E4aA;
    address public constant NONFUNGIBLE_POSITION_MANAGER = 0x3BdC3437405f7D801b6036532713fc1F179136a6;
    address public constant SWAP_ROUTER_02 = 0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a;

    uint256 public constant INITIAL_LAUNCH_FEE = 0.001 ether;

    event StableDirectDeployment(
        address indexed deployer,
        address governance,
        address feePolicy,
        address revenueRouter,
        address directLocker,
        address directFactory,
        address pendingTreasurySafe
    );

    function run() external {
        require(block.chainid == 988, "NOT_STABLE_MAINNET");
        require(USDT0.code.length != 0, "USDT0_NOT_DEPLOYED");
        require(UNISWAP_V3_FACTORY.code.length != 0, "V3_FACTORY_NOT_DEPLOYED");
        require(NONFUNGIBLE_POSITION_MANAGER.code.length != 0, "POSITION_MANAGER_NOT_DEPLOYED");
        require(SWAP_ROUTER_02.code.length != 0, "SWAP_ROUTER_NOT_DEPLOYED");

        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address guardian = VM.envAddress("GOVERNANCE_GUARDIAN");
        require(guardian != address(0) && guardian != deployer && guardian != BLUEFUN_SAFE, "INVALID_GUARDIAN");

        VM.startBroadcast(key);
        StakingTimelock governance = new StakingTimelock(deployer, guardian, 7 days);
        StableFeePolicy policy = new StableFeePolicy(address(governance), guardian, INITIAL_LAUNCH_FEE);
        StableRevenueRouter router = new StableRevenueRouter(address(governance), BLUEFUN_SAFE);
        StableV3LiquidityLocker locker = new StableV3LiquidityLocker(
            deployer,
            USDT0,
            BLUEFUN_SAFE,
            IStableUniswapV3Factory(UNISWAP_V3_FACTORY),
            IStableNonfungiblePositionManager(NONFUNGIBLE_POSITION_MANAGER),
            _curveConfig()
        );
        StableV3DirectLaunchFactory factory = new StableV3DirectLaunchFactory(
            deployer,
            locker,
            policy,
            router,
            IStableUSDT0(USDT0),
            IStableSwapRouter02(SWAP_ROUTER_02)
        );
        locker.setFactory(address(factory));
        factory.transferOwnership(address(governance));
        VM.stopBroadcast();

        emit StableDirectDeployment(
            deployer,
            address(governance),
            address(policy),
            address(router),
            address(locker),
            address(factory),
            BLUEFUN_SAFE
        );
    }

    function _curveConfig() private pure returns (StableV3LiquidityLocker.CurveConfig memory) {
        return StableV3LiquidityLocker.CurveConfig({
            // Preserve the curve width while making the first executable price
            // approximately 4,009 USDT0 FDV for a one-billion-token supply.
            canonicalTickLower: -572_600,
            canonicalTickUpper: 400_600,
            canonicalInitialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630_000_000
        });
    }
}
