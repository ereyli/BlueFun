// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IFeePolicy} from "../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../src/interfaces/IRevenueRouter.sol";
import {StakingTimelock} from "../src/StakingTimelock.sol";
import {IStableUSDT0, StableV3DirectLaunchFactory} from "../src/stable/StableV3DirectLaunchFactory.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";
import {
    IStableNonfungiblePositionManager,
    IStableSwapRouter02,
    IStableUniswapV3Factory
} from "../src/stable/StableUniswapV3Interfaces.sol";

interface VmStableRedeploy {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IStableAdminView {
    function admin() external view returns (address);
}

/// @notice Replaces only the inactive locker/factory pair after mainnet canary validation.
contract RedeployStableDirectMainnet {
    VmStableRedeploy private constant VM =
        VmStableRedeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant BLUEFUN_SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant UNISWAP_V3_FACTORY = 0x88F0a512eF09175D456bc9547f914f48C013E4aA;
    address public constant NONFUNGIBLE_POSITION_MANAGER = 0x3BdC3437405f7D801b6036532713fc1F179136a6;
    address public constant SWAP_ROUTER_02 = 0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a;

    event StableDirectReplacement(
        address indexed deployer,
        address indexed governance,
        address directLocker,
        address directFactory,
        address feePolicy,
        address revenueRouter
    );

    function run() external {
        require(block.chainid == 988, "NOT_STABLE_MAINNET");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address governance = VM.envAddress("STABLE_GOVERNANCE_ADDRESS");
        address policy = VM.envAddress("STABLE_FEE_POLICY_ADDRESS");
        address revenueRouter = VM.envAddress("STABLE_REVENUE_ROUTER_ADDRESS");

        require(StakingTimelock(payable(governance)).owner() == deployer, "NOT_GOVERNANCE_OWNER");
        require(IStableAdminView(policy).admin() == governance, "POLICY_ADMIN_MISMATCH");

        VM.startBroadcast(key);
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
            IFeePolicy(policy),
            IRevenueRouter(revenueRouter),
            IStableUSDT0(USDT0),
            IStableSwapRouter02(SWAP_ROUTER_02)
        );
        locker.setFactory(address(factory));
        factory.transferOwnership(governance);
        VM.stopBroadcast();

        emit StableDirectReplacement(deployer, governance, address(locker), address(factory), policy, revenueRouter);
    }

    function _curveConfig() private pure returns (StableV3LiquidityLocker.CurveConfig memory) {
        return StableV3LiquidityLocker.CurveConfig({
            canonicalTickLower: -572_600,
            canonicalTickUpper: 400_600,
            canonicalInitialSqrtPriceX96: 94_695_766_502_043_500_531_423_789_355_630_000_000
        });
    }
}
