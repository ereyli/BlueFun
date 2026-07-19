// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {NFTFeePolicy} from "../src/NFTFeePolicy.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {BlueNFTMarketplace} from "../src/BlueNFTMarketplace.sol";

interface VmNFTLaunchpadBase {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

/// @notice Deploys but does not configure or broadcast unless explicitly invoked with forge script --broadcast.
contract DeployNFTLaunchpadBaseMainnet {
    VmNFTLaunchpadBase internal constant vm =
        VmNFTLaunchpadBase(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NFTLaunchpadDeployed(
        address indexed feePolicy,
        address indexed dropController,
        address indexed collectionFactory,
        address marketplace,
        address platformWallet
    );

    function run() external {
        address platformWallet = vm.envAddress("NFT_PLATFORM_WALLET");
        require(platformWallet != address(0), "INVALID_PLATFORM_WALLET");

        vm.startBroadcast(platformWallet);
        NFTFeePolicy policy = new NFTFeePolicy(platformWallet, platformWallet, payable(platformWallet));
        BlueDropController controller = new BlueDropController(policy);
        NFTCollectionFactory factory = new NFTCollectionFactory(policy, address(controller));
        BlueNFTMarketplace marketplace = new BlueNFTMarketplace(policy, factory);
        vm.stopBroadcast();

        emit NFTLaunchpadDeployed(
            address(policy), address(controller), address(factory), address(marketplace), platformWallet
        );
    }
}
