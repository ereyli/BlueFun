// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BlueEdition1155} from "../src/BlueEdition1155.sol";
import {BluePFP721} from "../src/BluePFP721.sol";
import {BlueNFTMarketplace} from "../src/BlueNFTMarketplace.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";
import {BlueNFTOffers} from "../src/BlueNFTOffers.sol";

interface IWETHCanary {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface VmNFTV3Canary {
    function envUint(string calldata name) external view returns (uint256);
    function envString(string calldata name) external view returns (string memory);
    function envBytes32(string calldata name) external view returns (bytes32);
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function toString(bytes32 value) external pure returns (string memory);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Small-value, end-to-end Base mainnet validation for the canonical V3 NFT deployment.
contract SmokeNFTLaunchpadV3BaseMainnet {
    VmNFTV3Canary private constant vm = VmNFTV3Canary(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BASE_CHAIN_ID = 8453;
    uint256 private constant SUPPLY = 1_000;
    uint256 private constant LAUNCH_FEE = 0.001 ether;
    uint128 private constant MINT_PRICE = 0.000001 ether;
    uint128 private constant LISTING_PRICE = 0.000002 ether;
    uint128 private constant OFFER_PRICE = 0.000003 ether;
    uint16 private constant ROYALTY_BPS = 500;
    uint16 private constant MARKETPLACE_FEE_BPS = 80;

    address private constant EDITION_FACTORY = 0xDCB1AC13fEdE90E7fdCAeB419a1803B2473cf0B3;
    address private constant PFP_FACTORY = 0xb0c5F7b8372a9c85C449AfF8dFD1B833186046A2;
    address private constant CONTROLLER = 0xf65BdF38Fc7E47A4750564853f55F9D6760A7767;
    address private constant EDITION_MARKET = 0x0B68d3aE48d8f1880CC79Aa8190F41516dbDE5Dc;
    address private constant PFP_MARKET = 0x6420b1C74029927DF9Ba552445094e15788bA76c;
    address private constant OFFERS = 0x72dB1Ef886b1880C89cBE54cAA48AA6B6DdF932E;
    address private constant WETH = 0x4200000000000000000000000000000000000006;

    event CanaryCollections(address indexed edition, address indexed pfp, address indexed creator, address buyer);
    event CanaryListingIds(uint256 editionSale, uint256 pfpSale, uint256 editionCancelled, uint256 pfpCancelled);
    event CanaryOfferHashes(bytes32 editionAccepted, bytes32 pfpAccepted, bytes32 cancelled);
    event CanaryReveal(address indexed pfp, uint64 revealTime);

    uint256 private creatorKey;
    uint256 private buyerKey;
    address private creator;
    address private buyer;
    address private edition;
    address private pfp;
    uint64 private revealTime;
    bytes32 private revealSecret;
    bytes32 private provenanceHash;
    string private editionItemURI;
    string private editionContractURI;
    string private pfpMetadataBaseURI;
    string private pfpPlaceholderURI;
    string private pfpContractURI;
    uint256 private editionSale;
    uint256 private pfpSale;
    uint256 private editionCancelled;
    uint256 private pfpCancelled;
    bytes32 private editionOfferHash;
    bytes32 private pfpOfferHash;
    bytes32 private cancelledOfferHash;

    function run() external {
        require(block.chainid == BASE_CHAIN_ID, "NOT_BASE_MAINNET");
        _loadConfig();
        _fundCreator();
        _launchEdition();
        _launchPFP();
        _createPhases();
        _mintAndList();
        _buyListings();
        _cancelListingsAndFundOffers();
        _acceptOffers();
        _cancelOffer();

        emit CanaryCollections(edition, pfp, creator, buyer);
        emit CanaryListingIds(editionSale, pfpSale, editionCancelled, pfpCancelled);
        emit CanaryOfferHashes(editionOfferHash, pfpOfferHash, cancelledOfferHash);
        emit CanaryReveal(pfp, revealTime);
    }

    function _loadConfig() private {
        creatorKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        buyerKey = vm.envUint("NFT_CANARY_BUYER_PRIVATE_KEY");
        creator = vm.addr(creatorKey);
        buyer = vm.addr(buyerKey);
        require(creator == 0x9d5f55a644eF0eB9FF82dbd14Dd0471de3ff5bfb, "WRONG_CREATOR");
        require(creator != buyer, "IDENTICAL_TEST_WALLETS");
        editionItemURI = vm.envString("NFT_CANARY_EDITION_ITEM_URI");
        editionContractURI = vm.envString("NFT_CANARY_EDITION_CONTRACT_URI");
        pfpMetadataBaseURI = vm.envString("NFT_CANARY_PFP_BASE_URI");
        pfpPlaceholderURI = vm.envString("NFT_CANARY_PFP_PLACEHOLDER_URI");
        pfpContractURI = vm.envString("NFT_CANARY_PFP_CONTRACT_URI");
        provenanceHash = vm.envBytes32("NFT_CANARY_PFP_PROVENANCE_HASH");
        revealSecret = vm.envBytes32("NFT_CANARY_PFP_REVEAL_SECRET");
    }

    function _fundCreator() private {
        vm.startBroadcast(buyerKey);
        payable(creator).transfer(0.0015 ether);
        vm.stopBroadcast();
    }

    function _launchEdition() private {
        vm.startBroadcast(creatorKey);
        (, edition) = NFTCollectionFactory(EDITION_FACTORY).createCollection{value: LAUNCH_FEE}(
            NFTCollectionFactory.CreateCollectionParams({
                name: "BlueFun V3 Edition Canary 1000",
                symbol: "BFV3E",
                contractURI: editionContractURI,
                initialItemURI: editionItemURI,
                initialMaxSupply: SUPPLY,
                initialCreatorReserve: 10,
                royaltyRecipient: creator,
                royaltyBps: ROYALTY_BPS,
                salt: keccak256("BLUEFUN_V3_EDITION_CANARY_20260720")
            })
        );
        vm.stopBroadcast();
    }

    function _launchPFP() private {
        revealTime = uint64(block.timestamp + 120);
        bytes32 innerRevealCommitment = keccak256(abi.encode(pfpMetadataBaseURI, revealSecret));
        vm.startBroadcast(creatorKey);
        (, pfp) = NFTPFPFactory(PFP_FACTORY).createPFPCollection{value: LAUNCH_FEE}(
            NFTPFPFactory.CreatePFPParams({
                name: "BlueFun V3 Pioneers 1000",
                symbol: "BFV3P",
                contractURI: pfpContractURI,
                baseURI: vm.toString(innerRevealCommitment),
                placeholderURI: pfpPlaceholderURI,
                maxSupply: SUPPLY,
                provenanceHash: provenanceHash,
                revealed: false,
                creatorReserve: 10,
                revealTime: revealTime,
                freezeOnReveal: true,
                royaltyRecipient: creator,
                royaltyBps: ROYALTY_BPS,
                salt: keccak256("BLUEFUN_V3_PFP_CANARY_20260720")
            })
        );
        vm.stopBroadcast();
    }

    function _createPhases() private {
        vm.startBroadcast(creatorKey);
        BlueDropController(CONTROLLER).createPhase(edition, 1, _phase());
        BlueDropController(CONTROLLER).createPhase(pfp, 1, _phase());
        vm.stopBroadcast();
    }

    function _mintAndList() private {
        vm.startBroadcast(buyerKey);
        BlueDropController(CONTROLLER).mintPublic{value: MINT_PRICE * 3}(
            edition, 1, 1, 3, buyer, MINT_PRICE, block.timestamp + 1 days
        );
        BlueDropController(CONTROLLER).mintPublic{value: MINT_PRICE * 3}(
            pfp, 1, 1, 3, buyer, MINT_PRICE, block.timestamp + 1 days
        );
        BlueEdition1155(edition).setApprovalForAll(EDITION_MARKET, true);
        BluePFP721(pfp).setApprovalForAll(PFP_MARKET, true);
        editionSale = BlueNFTMarketplace(EDITION_MARKET)
            .createListing(edition, 1, 1, LISTING_PRICE, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        pfpSale = BlueNFTMarketplace721(PFP_MARKET)
            .createListing(pfp, 1, LISTING_PRICE, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        vm.stopBroadcast();
    }

    function _buyListings() private {
        vm.startBroadcast(creatorKey);
        BlueNFTMarketplace(EDITION_MARKET).buy{value: LISTING_PRICE}(editionSale, 1, creator);
        BlueNFTMarketplace721(PFP_MARKET).buy{value: LISTING_PRICE}(pfpSale, creator);
        vm.stopBroadcast();
    }

    function _cancelListingsAndFundOffers() private {
        vm.startBroadcast(buyerKey);
        editionCancelled = BlueNFTMarketplace(EDITION_MARKET)
            .createListing(edition, 1, 1, LISTING_PRICE, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        BlueNFTMarketplace(EDITION_MARKET).cancelListing(editionCancelled);
        pfpCancelled = BlueNFTMarketplace721(PFP_MARKET)
            .createListing(pfp, 2, LISTING_PRICE, uint64(block.timestamp), uint64(block.timestamp + 1 days));
        BlueNFTMarketplace721(PFP_MARKET).cancelListing(pfpCancelled);
        IWETHCanary(WETH).deposit{value: OFFER_PRICE * 3}();
        require(IWETHCanary(WETH).approve(OFFERS, OFFER_PRICE * 3), "WETH_APPROVAL_FAILED");
        vm.stopBroadcast();
    }

    function _acceptOffers() private {
        BlueNFTOffers.Offer memory editionOffer = _offer(buyer, creator, edition, 1, 2, 1001);
        BlueNFTOffers.Offer memory pfpOffer = _offer(buyer, creator, pfp, 1, 1, 1002);
        editionOfferHash = BlueNFTOffers(OFFERS).hashOffer(editionOffer);
        pfpOfferHash = BlueNFTOffers(OFFERS).hashOffer(pfpOffer);
        bytes memory editionSignature = _sign(buyerKey, editionOfferHash);
        bytes memory pfpSignature = _sign(buyerKey, pfpOfferHash);
        uint256 minimumSellerProceeds = uint256(OFFER_PRICE) * (10_000 - ROYALTY_BPS - MARKETPLACE_FEE_BPS) / 10_000;

        vm.startBroadcast(creatorKey);
        BlueEdition1155(edition).setApprovalForAll(OFFERS, true);
        BluePFP721(pfp).approve(OFFERS, 1);
        BlueNFTOffers(OFFERS).acceptOfferWithMinProceeds(editionOffer, 1, 1, editionSignature, minimumSellerProceeds);
        BlueNFTOffers(OFFERS).acceptOfferWithMinProceeds(pfpOffer, 1, 1, pfpSignature, minimumSellerProceeds);
        vm.stopBroadcast();
    }

    function _cancelOffer() private {
        BlueNFTOffers.Offer memory cancelledOffer = _offer(buyer, address(0), pfp, 0, 1, 1003);
        cancelledOffer.offerType = 1;
        cancelledOfferHash = BlueNFTOffers(OFFERS).hashOffer(cancelledOffer);
        vm.startBroadcast(buyerKey);
        BlueNFTOffers(OFFERS).cancelOffer(cancelledOffer);
        BlueNFTOffers(OFFERS).cancelAllOffers(2_000);
        vm.stopBroadcast();
    }

    function _phase() private view returns (BlueDropController.PhaseConfig memory) {
        return BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: MINT_PRICE,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 7 days),
            phaseSupplyCap: 990,
            defaultWalletLimit: 10,
            maxPerTransaction: 5,
            merkleRoot: bytes32(0)
        });
    }

    function _offer(address maker, address taker, address collection, uint256 tokenId, uint8 standard, uint256 nonce)
        private
        view
        returns (BlueNFTOffers.Offer memory)
    {
        return BlueNFTOffers.Offer({
            maker: maker,
            taker: taker,
            recipient: maker,
            collection: collection,
            tokenId: tokenId,
            unitPrice: OFFER_PRICE,
            quantity: 1,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            nonce: nonce,
            standard: standard,
            offerType: 0
        });
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
