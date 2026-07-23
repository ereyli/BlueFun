// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20Minimal} from "../src/UniswapV4LiquidityLocker.sol";
import {StableRevenueRouter} from "../src/stable/StableRevenueRouter.sol";
import {StableV3DirectLaunchFactory} from "../src/stable/StableV3DirectLaunchFactory.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";
import {
    IStableNonfungiblePositionManager,
    IStableSwapRouter02
} from "../src/stable/StableUniswapV3Interfaces.sol";

interface VmStableCanaryCompletion {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Phase two of the Stable canary, run after the launch transaction confirms.
/// @dev Resolves the actual position ID from the confirmed factory record before broadcasting.
contract CompleteStableDirectCanaryMainnet {
    VmStableCanaryCompletion private constant VM =
        VmStableCanaryCompletion(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant BLUEFUN_SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant NONFUNGIBLE_POSITION_MANAGER = 0x3BdC3437405f7D801b6036532713fc1F179136a6;
    address public constant SWAP_ROUTER_02 = 0x32eaf9B5d5F2CD7361c5012890C943D7de84C22a;

    function run() external {
        require(block.chainid == 988, "NOT_STABLE_MAINNET");

        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        uint256 launchId = VM.envUint("STABLE_CANARY_LAUNCH_ID");
        StableV3DirectLaunchFactory factory =
            StableV3DirectLaunchFactory(payable(VM.envAddress("STABLE_DIRECT_FACTORY_ADDRESS")));
        StableV3LiquidityLocker locker =
            StableV3LiquidityLocker(VM.envAddress("STABLE_DIRECT_LOCKER_ADDRESS"));
        StableRevenueRouter revenueRouter =
            StableRevenueRouter(payable(VM.envAddress("STABLE_REVENUE_ROUTER_ADDRESS")));

        (address token, address creator,, bytes32 positionId) = factory.launches(launchId);
        require(token != address(0) && creator == deployer, "CANARY_NOT_FOUND");
        (uint256 storedLaunchId,,,, uint256 tokenId,,,,,) = locker.lockedPositions(positionId);
        require(storedLaunchId == launchId, "POSITION_MISMATCH");
        require(
            IStableNonfungiblePositionManager(NONFUNGIBLE_POSITION_MANAGER).ownerOf(tokenId) == address(locker),
            "LP_NFT_NOT_LOCKED"
        );

        uint256 tokensSold = IERC20Minimal(token).balanceOf(deployer) / 10;
        require(tokensSold != 0, "ZERO_SELL");

        VM.startBroadcast(key);
        require(IERC20Minimal(token).approve(SWAP_ROUTER_02, tokensSold), "TOKEN_APPROVAL_FAILED");
        IStableSwapRouter02(SWAP_ROUTER_02).exactInputSingle(
            IStableSwapRouter02.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: USDT0,
                fee: locker.POOL_FEE(),
                recipient: deployer,
                amountIn: tokensSold,
                amountOutMinimum: 1,
                sqrtPriceLimitX96: 0
            })
        );
        require(IERC20Minimal(token).approve(SWAP_ROUTER_02, 0), "TOKEN_APPROVAL_RESET_FAILED");
        locker.collectFees(positionId);
        locker.claimFees(USDT0);
        locker.sweepPlatformFees(USDT0);
        locker.sweepPlatformFees(token);
        revenueRouter.claimTreasuryRevenue();
        VM.stopBroadcast();
    }
}
