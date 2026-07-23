// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20Minimal} from "../src/UniswapV4LiquidityLocker.sol";
import {StableV3DirectLaunchFactory} from "../src/stable/StableV3DirectLaunchFactory.sol";
import {StableV3LiquidityLocker} from "../src/stable/StableV3LiquidityLocker.sol";

interface VmStableSmoke {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Phase one of the Stable production canary: launch and atomically buy.
/// @dev Completion is deliberately a separate script. Uniswap v3 position NFT IDs
/// can change between Foundry simulation and broadcast when another pool mints.
contract SmokeStableDirectMainnet {
    VmStableSmoke private constant VM = VmStableSmoke(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant BLUEFUN_SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    uint256 public constant INITIAL_BUY_USDT0 = 1_000_000;

    function run() external {
        require(block.chainid == 988, "NOT_STABLE_MAINNET");

        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        StableV3DirectLaunchFactory factory =
            StableV3DirectLaunchFactory(payable(VM.envAddress("STABLE_DIRECT_FACTORY_ADDRESS")));
        StableV3LiquidityLocker locker =
            StableV3LiquidityLocker(VM.envAddress("STABLE_DIRECT_LOCKER_ADDRESS"));

        require(address(factory.liquidityLocker()) == address(locker), "LOCKER_MISMATCH");
        require(locker.platformFeeRecipient() == BLUEFUN_SAFE, "SAFE_MISMATCH");
        require(locker.factory() == address(factory), "FACTORY_MISMATCH");
        require(factory.launchFee() == 0.001 ether, "UNEXPECTED_LAUNCH_FEE");

        StableV3DirectLaunchFactory.TokenMetadata memory metadata = StableV3DirectLaunchFactory.TokenMetadata({
            name: "BlueFun Stable 4K Canary",
            symbol: "BFS4K",
            contractURI: "ipfs://bluefun-stable-4k-mainnet-canary",
            salt: keccak256(abi.encode("BLUEFUN_STABLE_4K_MAINNET_CANARY", block.timestamp, deployer))
        });

        VM.startBroadcast(key);
        require(IERC20Minimal(USDT0).approve(address(factory), INITIAL_BUY_USDT0), "FACTORY_APPROVAL_FAILED");
        factory.createLaunchWithInitialBuy{value: factory.launchFee()}(
            metadata, factory.launchConfigHash(), block.timestamp + 30 minutes, INITIAL_BUY_USDT0, 1
        );
        VM.stopBroadcast();
    }
}
