// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BluePFP721} from "../src/BluePFP721.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";

interface VmNFTPFPV4Smoke {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external pure returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Mainnet canary for the V4 PFP tokenURI fix and canonical marketplace registry.
contract SmokeNFTPFPV4TokenURI {
    VmNFTPFPV4Smoke private constant vm =
        VmNFTPFPV4Smoke(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant PFP_FACTORY = 0x022742905A07f4534f9794ceb8c42bE23a1c6815;
    address private constant CONTROLLER = 0xf7fC2F208b936a5858F9Ae7F7750147C8284A2c6;
    address private constant PFP_MARKET = 0x8a777D7d590b658ab07b0aEE90cCC51b79c2981d;
    uint256 private constant LAUNCH_FEE = 0.001 ether;
    string private constant BASE_URI = "ipfs://QmWFiDvTPFY6sR99JZffzaMcrYwW88pw1HTswEjZNp8bpd/bluefun/";

    event V4PFPCanary(address indexed collection, uint256 indexed listingId, string firstTokenURI);

    function run() external {
        require(block.chainid == 8453, "NOT_BASE_MAINNET");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address creator = vm.addr(deployerKey);
        require(creator == 0x9d5f55a644eF0eB9FF82dbd14Dd0471de3ff5bfb, "WRONG_CREATOR");

        vm.startBroadcast(deployerKey);
        (, address collectionAddress) = NFTPFPFactory(PFP_FACTORY).createPFPCollection{value: LAUNCH_FEE}(
            NFTPFPFactory.CreatePFPParams({
                name: "BlueFun V4 PFP URI Canary",
                symbol: "BFV4URI",
                contractURI: "ipfs://QmRThb9SyyBuVcEnNxgdUpefscZuzhDVYzyzZsjyZrk66j",
                baseURI: BASE_URI,
                placeholderURI: "ipfs://Qmd2qGkfrocq43XUD9NCzzDp1SQPxLbtJGhcz718CB3gqg",
                maxSupply: 1_000,
                provenanceHash: 0xee555804e2a6700303a88a6276620096f8dcc4086b06ce206c452465113eb0f3,
                revealed: true,
                creatorReserve: 0,
                revealTime: 0,
                freezeOnReveal: true,
                royaltyRecipient: creator,
                royaltyBps: 500,
                salt: keccak256("BLUEFUN_V4_PFP_URI_CANARY_20260720")
            })
        );
        BlueDropController(CONTROLLER).createPhase(
            collectionAddress,
            1,
            BlueDropController.PhaseConfig({
                phaseType: BlueDropController.PhaseType.PUBLIC,
                limitMode: BlueDropController.LimitMode.PER_PHASE,
                currency: address(0),
                mintPrice: 0,
                startTime: uint64(block.timestamp),
                endTime: uint64(block.timestamp + 7 days),
                phaseSupplyCap: 1_000,
                defaultWalletLimit: 10,
                maxPerTransaction: 5,
                merkleRoot: bytes32(0)
            })
        );
        BlueDropController(CONTROLLER).mintPublic(collectionAddress, 1, 1, 3, creator, 0, block.timestamp + 1 days);

        BluePFP721 collection = BluePFP721(collectionAddress);
        string memory firstTokenURI = collection.tokenURI(1);
        require(keccak256(bytes(firstTokenURI)) == keccak256(bytes(string.concat(BASE_URI, "1"))), "BAD_TOKEN_URI");
        collection.setApprovalForAll(PFP_MARKET, true);
        uint256 listingId = BlueNFTMarketplace721(PFP_MARKET).createListing(
            collectionAddress, 1, 0.000002 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        BlueNFTMarketplace721(PFP_MARKET).cancelListing(listingId);
        collection.setApprovalForAll(PFP_MARKET, false);
        vm.stopBroadcast();

        emit V4PFPCanary(collectionAddress, listingId, firstTokenURI);
    }
}
