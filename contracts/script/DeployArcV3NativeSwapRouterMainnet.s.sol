// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ArcV3NativeSwapRouter} from "../src/arc/ArcV3NativeSwapRouter.sol";
import {IArcNativeUSDC, IArcV3Factory, IArcV3SwapRouter} from "../src/arc/ArcV3Interfaces.sol";

interface VmArcNativeRouterDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployArcV3NativeSwapRouterMainnet {
    VmArcNativeRouterDeploy private constant VM =
        VmArcNativeRouterDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address public constant UNISWAP_V3_FACTORY = 0xf0db7b58379503491d857dB50AC9ece64c653918;
    address public constant SWAP_ROUTER_02 = 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77;

    event ArcV3NativeSwapRouterDeployed(address indexed deployer, address indexed nativeSwapRouter);

    function run() external {
        require(block.chainid == 5_042, "NOT_ARC_MAINNET");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);

        VM.startBroadcast(key);
        ArcV3NativeSwapRouter nativeSwapRouter = new ArcV3NativeSwapRouter(
            IArcNativeUSDC(ARC_USDC),
            IArcV3Factory(UNISWAP_V3_FACTORY),
            IArcV3SwapRouter(SWAP_ROUTER_02)
        );
        VM.stopBroadcast();

        require(nativeSwapRouter.isReady(), "NATIVE_SWAP_ROUTER_NOT_READY");
        emit ArcV3NativeSwapRouterDeployed(deployer, address(nativeSwapRouter));
    }
}
