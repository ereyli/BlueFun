// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {INFTFeePolicy} from "../src/interfaces/INFTFeePolicy.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";

interface VmNFTPFPBase {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

/// @notice Adds the ERC-721 PFP module without replacing the existing NFT protocol contracts.
contract DeployNFTPFPBaseMainnet {
    VmNFTPFPBase internal constant vm = VmNFTPFPBase(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NFTPFPModuleDeployed(address indexed factory, address indexed marketplace, address feePolicy, address dropController);

    function run() external {
        address platformWallet = vm.envAddress("NFT_PLATFORM_WALLET");
        address feePolicy = vm.envAddress("NFT_FEE_POLICY");
        address dropController = vm.envAddress("NFT_DROP_CONTROLLER");
        require(platformWallet != address(0) && feePolicy != address(0) && dropController != address(0), "INVALID_PFP_CONFIG");

        vm.startBroadcast(platformWallet);
        NFTPFPFactory factory = new NFTPFPFactory(INFTFeePolicy(feePolicy), dropController);
        BlueNFTMarketplace721 marketplace = new BlueNFTMarketplace721(INFTFeePolicy(feePolicy), factory);
        vm.stopBroadcast();

        emit NFTPFPModuleDeployed(address(factory), address(marketplace), feePolicy, dropController);
    }
}
