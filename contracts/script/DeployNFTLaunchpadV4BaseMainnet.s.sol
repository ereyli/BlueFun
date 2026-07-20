// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {NFTFeePolicy} from "../src/NFTFeePolicy.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueNFTMarketplace} from "../src/BlueNFTMarketplace.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";
import {BlueNFTOffers} from "../src/BlueNFTOffers.sol";
import {IERC20Offers} from "../src/interfaces/IERC20Offers.sol";

interface VmNFTLaunchpadV4Base {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(address signer) external;
    function stopBroadcast() external;
}

/// @notice Canonical Base deployment with finite PFP token URIs and atomic native/WETH settlement.
contract DeployNFTLaunchpadV4BaseMainnet {
    uint256 internal constant BASE_MAINNET_CHAIN_ID = 8453;
    address internal constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    VmNFTLaunchpadV4Base internal constant vm =
        VmNFTLaunchpadV4Base(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NFTLaunchpadV4Deployed(
        address indexed feePolicy,
        address indexed controller,
        address indexed editionFactory,
        address pfpFactory,
        address editionMarketplace,
        address pfpMarketplace,
        address offers,
        address weth
    );

    function run() external {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "NOT_BASE_MAINNET");
        address deployer = vm.envAddress("NFT_DEPLOYER");
        address admin = vm.envAddress("NFT_ADMIN");
        address guardian = vm.envAddress("NFT_GUARDIAN");
        address payable platformWallet = payable(vm.envAddress("NFT_PLATFORM_WALLET"));
        address weth = vm.envAddress("NFT_WETH");
        require(
            deployer != address(0) && admin != address(0) && guardian != address(0) && platformWallet != address(0)
                && weth != address(0),
            "INVALID_V4_CONFIG"
        );
        require(weth == BASE_WETH, "INVALID_BASE_WETH");
        require(admin.code.length != 0, "ADMIN_MUST_BE_SAFE");
        require(guardian == admin && platformWallet == admin, "SAFE_MUST_CONTROL_ALL_ROLES");

        vm.startBroadcast(deployer);
        NFTFeePolicy policy = new NFTFeePolicy(admin, guardian, platformWallet);
        BlueDropController controller = new BlueDropController(policy, weth, deployer);
        NFTCollectionFactory editionFactory = new NFTCollectionFactory(policy, address(controller), weth);
        NFTPFPFactory pfpFactory = new NFTPFPFactory(policy, address(controller), weth);
        controller.configureFactories(address(editionFactory), address(pfpFactory));
        BlueNFTMarketplace editionMarketplace = new BlueNFTMarketplace(policy, editionFactory, weth);
        BlueNFTMarketplace721 pfpMarketplace = new BlueNFTMarketplace721(policy, pfpFactory, weth);
        BlueNFTOffers offers = new BlueNFTOffers(policy, editionFactory, pfpFactory, IERC20Offers(weth));
        vm.stopBroadcast();

        emit NFTLaunchpadV4Deployed(
            address(policy),
            address(controller),
            address(editionFactory),
            address(pfpFactory),
            address(editionMarketplace),
            address(pfpMarketplace),
            address(offers),
            weth
        );
    }
}
