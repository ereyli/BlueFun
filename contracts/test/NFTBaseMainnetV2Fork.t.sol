// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueEdition1155} from "../src/BlueEdition1155.sol";
import {BluePFP721} from "../src/BluePFP721.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BlueNFTMarketplace} from "../src/BlueNFTMarketplace.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";
import {BlueNFTOffers} from "../src/BlueNFTOffers.sol";

interface IWETHFork {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Exercises the exact verified V2 deployment against a Base mainnet fork.
/// @dev Run with: forge test --fork-url $BASE_RPC_URL --match-contract NFTBaseMainnetV2ForkTest -vv
contract NFTBaseMainnetV2ForkTest is Test {
    address internal constant DROP_CONTROLLER = 0xa799002045291B4C88Db11d35F476F532Ea012cB;
    address internal constant EDITION_FACTORY = 0x38D3A8eE94f49dDEB7Ba5C0f202e1aaf4b07c63a;
    address internal constant PFP_FACTORY = 0x5c1796111E6e57d0D13555Da1CdB2b1a98005732;
    address internal constant EDITION_MARKETPLACE = 0x79509aB5348Ecc30616cE7a8460d014CfEe5737b;
    address internal constant PFP_MARKETPLACE = 0x22c0B3344af12DE3a5F6315663AF2c9B9042e9f8;
    address internal constant OFFERS = 0x58B7e9f6c980800754cdE5C9458E2Ec42EBeb0ca;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;

    uint256 internal constant MAKER_KEY = 0xB20BA5E;
    address internal creator = address(0xC0FFEE01);
    address internal buyer = address(0xB0B01);
    address internal other = address(0xCAFE01);
    address internal maker;

    BlueDropController internal controller = BlueDropController(DROP_CONTROLLER);
    NFTCollectionFactory internal editionFactory = NFTCollectionFactory(EDITION_FACTORY);
    NFTPFPFactory internal pfpFactory = NFTPFPFactory(PFP_FACTORY);
    BlueNFTMarketplace internal editionMarketplace = BlueNFTMarketplace(EDITION_MARKETPLACE);
    BlueNFTMarketplace721 internal pfpMarketplace = BlueNFTMarketplace721(PFP_MARKETPLACE);
    BlueNFTOffers internal offers = BlueNFTOffers(OFFERS);
    IWETHFork internal weth = IWETHFork(WETH);

    function setUp() public {
        maker = vm.addr(MAKER_KEY);
        if (block.chainid != 8453) return;
        vm.deal(creator, 20 ether);
        vm.deal(buyer, 20 ether);
        vm.deal(other, 20 ether);
        vm.deal(maker, 20 ether);
    }

    function testForkEditionLaunchMintMarketAndClaims() public {
        if (block.chainid != 8453) return;
        assertGt(EDITION_FACTORY.code.length, 0);
        assertGt(DROP_CONTROLLER.code.length, 0);
        assertGt(EDITION_MARKETPLACE.code.length, 0);

        NFTCollectionFactory.CreateCollectionParams memory params = NFTCollectionFactory.CreateCollectionParams({
            name: "BlueFun Fork Edition",
            symbol: "BFFE",
            contractURI: "ipfs://fork-collection",
            initialItemURI: "ipfs://fork-item",
            initialMaxSupply: 20,
            initialCreatorReserve: 0,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256("bluefun-v2-fork-edition")
        });
        uint256 launchFee = editionFactory.feePolicy().collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = editionFactory.createCollection{value: launchFee}(params);
        BlueEdition1155 collection = BlueEdition1155(deployed);
        assertEq(collection.owner(), creator);
        assertTrue(editionFactory.isBlueFunCollection(deployed));

        uint256 phaseId = _createPublicPhase(deployed, 0.01 ether, 10);
        vm.prank(buyer);
        controller.mintPublic{value: 0.03 ether}(
            deployed, 1, phaseId, 3, buyer, 0.01 ether, block.timestamp + 1 hours
        );
        assertEq(collection.balanceOf(buyer, 1), 3);
        assertEq(controller.pendingCreatorRevenue(deployed), 0.0294 ether);

        uint256 creatorBeforePrimaryClaim = creator.balance;
        controller.claimCreatorRevenue(deployed);
        assertEq(creator.balance, creatorBeforePrimaryClaim + 0.0294 ether);
        assertEq(controller.pendingCreatorRevenue(deployed), 0);

        vm.prank(buyer);
        collection.setApprovalForAll(EDITION_MARKETPLACE, true);
        vm.prank(buyer);
        uint256 listingId = editionMarketplace.createListing(
            deployed, 1, 2, 0.1 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        vm.prank(other);
        editionMarketplace.buy{value: 0.1 ether}(listingId, 1, other);
        assertEq(collection.balanceOf(other, 1), 1);
        assertEq(editionMarketplace.pendingRevenue(buyer), 0.0942 ether);
        assertEq(editionMarketplace.pendingRevenue(creator), 0.005 ether);

        uint256 sellerBeforeClaim = buyer.balance;
        vm.prank(buyer);
        editionMarketplace.claimRevenue();
        assertEq(buyer.balance, sellerBeforeClaim + 0.0942 ether);
        uint256 creatorBeforeRoyaltyClaim = creator.balance;
        vm.prank(creator);
        editionMarketplace.claimRevenue();
        assertEq(creator.balance, creatorBeforeRoyaltyClaim + 0.005 ether);

        vm.prank(buyer);
        editionMarketplace.cancelListing(listingId);
        (,,,,,, uint64 remaining, bool cancelled) = editionMarketplace.listings(listingId);
        assertEq(remaining, 1);
        assertTrue(cancelled);
    }

    function testForkPFPLaunchMintMarketOfferAndClaims() public {
        if (block.chainid != 8453) return;
        assertGt(PFP_FACTORY.code.length, 0);
        assertGt(PFP_MARKETPLACE.code.length, 0);
        assertGt(OFFERS.code.length, 0);

        NFTPFPFactory.CreatePFPParams memory params = NFTPFPFactory.CreatePFPParams({
            name: "BlueFun Fork PFP",
            symbol: "BFFP",
            contractURI: "ipfs://fork-pfp-collection",
            baseURI: "ipfs://fork-pfp/",
            placeholderURI: "ipfs://fork-hidden",
            maxSupply: 10,
            provenanceHash: keccak256("bluefun-v2-fork-provenance"),
            revealed: true,
            creatorReserve: 0,
            revealTime: 0,
            freezeOnReveal: false,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256("bluefun-v2-fork-pfp")
        });
        uint256 launchFee = pfpFactory.feePolicy().collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = pfpFactory.createPFPCollection{value: launchFee}(params);
        BluePFP721 collection = BluePFP721(deployed);
        assertEq(collection.owner(), creator);
        assertTrue(pfpFactory.isBlueFunCollection(deployed));

        uint256 phaseId = _createPublicPhase(deployed, 0.02 ether, 3);
        vm.prank(buyer);
        controller.mintPublic{value: 0.04 ether}(
            deployed, 1, phaseId, 2, buyer, 0.02 ether, block.timestamp + 1 hours
        );
        assertEq(collection.ownerOf(1), buyer);
        assertEq(collection.ownerOf(2), buyer);
        assertEq(controller.pendingCreatorRevenue(deployed), 0.0392 ether);

        uint256 creatorBeforePrimaryClaim = creator.balance;
        controller.claimCreatorRevenue(deployed);
        assertEq(creator.balance, creatorBeforePrimaryClaim + 0.0392 ether);

        vm.prank(buyer);
        collection.approve(PFP_MARKETPLACE, 1);
        vm.prank(buyer);
        uint256 listingId = pfpMarketplace.createListing(
            deployed, 1, 0.2 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        vm.prank(other);
        pfpMarketplace.buy{value: 0.2 ether}(listingId, other);
        assertEq(collection.ownerOf(1), other);
        assertEq(pfpMarketplace.pendingRevenue(buyer), 0.1884 ether);
        assertEq(pfpMarketplace.pendingRevenue(creator), 0.01 ether);

        vm.prank(buyer);
        pfpMarketplace.claimRevenue();
        vm.prank(creator);
        pfpMarketplace.claimRevenue();

        vm.prank(maker);
        weth.deposit{value: 1 ether}();
        vm.prank(maker);
        weth.approve(OFFERS, type(uint256).max);
        vm.prank(buyer);
        collection.approve(OFFERS, 2);

        BlueNFTOffers.Offer memory offer = BlueNFTOffers.Offer({
            maker: maker,
            taker: address(0),
            recipient: maker,
            collection: deployed,
            tokenId: 2,
            unitPrice: 0.3 ether,
            quantity: 1,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            nonce: 20260719,
            standard: 1,
            offerType: 0
        });
        bytes32 digest = offers.hashOffer(offer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        uint256 sellerWethBefore = weth.balanceOf(buyer);
        uint256 creatorWethBefore = weth.balanceOf(creator);

        vm.prank(buyer);
        offers.acceptOffer(offer, 2, 1, signature);
        assertEq(collection.ownerOf(2), maker);
        assertEq(weth.balanceOf(buyer), sellerWethBefore + 0.2826 ether);
        assertEq(weth.balanceOf(creator), creatorWethBefore + 0.015 ether);
        assertEq(offers.filledQuantity(digest), 1);
    }

    function _createPublicPhase(address collection, uint128 price, uint64 cap)
        private
        returns (uint256 phaseId)
    {
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: price,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            phaseSupplyCap: cap,
            defaultWalletLimit: uint32(cap),
            maxPerTransaction: uint32(cap),
            merkleRoot: bytes32(0)
        });
        vm.prank(creator);
        phaseId = controller.createPhase(collection, 1, config);
    }
}
