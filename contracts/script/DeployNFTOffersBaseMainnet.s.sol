// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BlueNFTOffers} from "../src/BlueNFTOffers.sol";
import {INFTFeePolicy} from "../src/interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "../src/interfaces/INFTCollectionRegistry.sol";
import {IERC20Offers} from "../src/interfaces/IERC20Offers.sol";

interface VmNFTOffersBase {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

/// @notice Adds non-custodial WETH offers without replacing existing collection or marketplace contracts.
contract DeployNFTOffersBaseMainnet {
    VmNFTOffersBase internal constant vm =
        VmNFTOffersBase(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NFTOffersDeployed(
        address indexed offers,
        address indexed weth,
        address feePolicy,
        address editionFactory,
        address pfpFactory
    );

    function run() external {
        address platformWallet = vm.envAddress("NFT_PLATFORM_WALLET");
        address feePolicy = vm.envAddress("NFT_FEE_POLICY");
        address editionFactory = vm.envAddress("NFT_COLLECTION_FACTORY");
        address pfpFactory = vm.envAddress("NFT_PFP_FACTORY");
        address weth = vm.envAddress("NFT_WETH");
        require(
            platformWallet != address(0) && feePolicy != address(0) && editionFactory != address(0)
                && pfpFactory != address(0) && weth != address(0),
            "INVALID_OFFERS_CONFIG"
        );

        vm.startBroadcast(platformWallet);
        BlueNFTOffers deployed = new BlueNFTOffers(
            INFTFeePolicy(feePolicy),
            INFTCollectionRegistry(editionFactory),
            INFTCollectionRegistry(pfpFactory),
            IERC20Offers(weth)
        );
        vm.stopBroadcast();
        emit NFTOffersDeployed(address(deployed), weth, feePolicy, editionFactory, pfpFactory);
    }
}
