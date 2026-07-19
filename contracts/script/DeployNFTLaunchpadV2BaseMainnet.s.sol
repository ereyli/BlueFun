// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {INFTFeePolicy} from "../src/interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "../src/interfaces/INFTCollectionRegistry.sol";
import {IERC20Offers} from "../src/interfaces/IERC20Offers.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueNFTMarketplace} from "../src/BlueNFTMarketplace.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";
import {BlueNFTOffers} from "../src/BlueNFTOffers.sol";

interface VmNFTLaunchpadV2Base {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

/// @notice Deploys the V2 controller, both creator-owned factories, both markets and WETH offers.
/// @dev Reuses the audited mutable fee policy so protocol fee configuration remains in one place.
contract DeployNFTLaunchpadV2BaseMainnet {
    VmNFTLaunchpadV2Base internal constant vm = VmNFTLaunchpadV2Base(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NFTLaunchpadV2Deployed(
        address indexed controller,
        address indexed editionFactory,
        address indexed pfpFactory,
        address editionMarketplace,
        address pfpMarketplace,
        address offers,
        address feePolicy,
        address weth
    );

    function run() external {
        address deployer = vm.envAddress("NFT_PLATFORM_WALLET");
        address feePolicyAddress = vm.envAddress("NFT_FEE_POLICY");
        address weth = vm.envAddress("NFT_WETH");
        require(deployer != address(0) && feePolicyAddress != address(0) && weth != address(0), "INVALID_V2_CONFIG");
        INFTFeePolicy policy = INFTFeePolicy(feePolicyAddress);

        vm.startBroadcast(deployer);
        BlueDropController controller = new BlueDropController(policy);
        NFTCollectionFactory editionFactory = new NFTCollectionFactory(policy, address(controller));
        NFTPFPFactory pfpFactory = new NFTPFPFactory(policy, address(controller));
        BlueNFTMarketplace editionMarketplace = new BlueNFTMarketplace(policy, editionFactory);
        BlueNFTMarketplace721 pfpMarketplace = new BlueNFTMarketplace721(policy, pfpFactory);
        BlueNFTOffers offers = new BlueNFTOffers(
            policy,
            INFTCollectionRegistry(address(editionFactory)),
            INFTCollectionRegistry(address(pfpFactory)),
            IERC20Offers(weth)
        );
        vm.stopBroadcast();

        emit NFTLaunchpadV2Deployed(
            address(controller), address(editionFactory), address(pfpFactory), address(editionMarketplace),
            address(pfpMarketplace), address(offers), feePolicyAddress, weth
        );
    }
}
