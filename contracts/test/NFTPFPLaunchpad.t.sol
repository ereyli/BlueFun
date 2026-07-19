// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {NFTFeePolicy} from "../src/NFTFeePolicy.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BluePFP721} from "../src/BluePFP721.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";

contract NFTPFPLaunchpadTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal buyer = address(0xB0B);
    address internal other = address(0xCAFE);
    address payable internal platformWallet = payable(address(0xB1E));

    NFTFeePolicy internal policy;
    BlueDropController internal controller;
    NFTPFPFactory internal factory;
    BlueNFTMarketplace721 internal marketplace;

    function setUp() public {
        policy = new NFTFeePolicy(address(this), address(this), platformWallet);
        controller = new BlueDropController(policy);
        factory = new NFTPFPFactory(policy, address(controller));
        marketplace = new BlueNFTMarketplace721(policy, factory);
        vm.deal(creator, 10 ether);
        vm.deal(buyer, 10 ether);
        vm.deal(other, 10 ether);
    }

    function testCreatorOwnsPFPAndLaunchFeeIsCollected() public {
        BluePFP721 collection = _create(false, 100);
        assertEq(collection.owner(), creator);
        assertEq(collection.originalCreator(), creator);
        assertEq(collection.collectionMaxSupply(), 100);
        assertEq(collection.maxSupply(1), 100);
        assertEq(platformWallet.balance, 0.001 ether);
        assertTrue(factory.isBlueFunCollection(address(collection)));
    }

    function testControllerMintsSequentialUniqueTokens() public {
        BluePFP721 collection = _create(true, 3);
        uint256 phaseId = _publicPhase(collection, 0.01 ether, 3);
        vm.prank(buyer);
        controller.mintPublic{value: 0.02 ether}(
            address(collection), 1, phaseId, 2, buyer, 0.01 ether, block.timestamp + 1 hours
        );
        assertEq(collection.ownerOf(1), buyer);
        assertEq(collection.ownerOf(2), buyer);
        assertEq(collection.balanceOf(buyer), 2);
        assertEq(collection.totalLifetimeMinted(), 2);
        assertEq(controller.pendingPlatformRevenue(), 0.0004 ether);
    }

    function testDelayedRevealCanBePermanentlyFrozen() public {
        BluePFP721 collection = _create(false, 10);
        uint256 phaseId = _publicPhase(collection, 0, 2);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);

        vm.prank(creator);
        collection.reveal("ipfs://metadata/", true);
        assertTrue(collection.revealed());
        assertTrue(collection.metadataFrozen());
        vm.prank(creator);
        vm.expectRevert(BluePFP721.MetadataFrozen.selector);
        collection.setBaseURI("ipfs://replacement/");
    }

    function testBurnDoesNotReopenPFPCollectionSupply() public {
        BluePFP721 collection = _create(true, 1);
        uint256 phaseId = _publicPhase(collection, 0, 0);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        collection.burn(1);
        assertEq(collection.totalLifetimeMinted(), 1);
        vm.prank(other);
        vm.expectRevert(BluePFP721.SupplyExceeded.selector);
        controller.mintPublic(address(collection), 1, phaseId, 1, other, 0, block.timestamp + 1 hours);
    }

    function testPFPMarketplaceSettlesPlatformAndRoyaltyFees() public {
        BluePFP721 collection = _create(true, 2);
        uint256 phaseId = _publicPhase(collection, 0, 2);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        collection.approve(address(marketplace), 1);
        vm.prank(buyer);
        uint256 listingId = marketplace.createListing(
            address(collection), 1, 1 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        vm.prank(other);
        marketplace.buy{value: 1 ether}(listingId, other);
        assertEq(collection.ownerOf(1), other);
        assertEq(marketplace.pendingPlatformRevenue(), 0.008 ether);
        assertEq(marketplace.pendingRevenue(creator), 0.05 ether);
        assertEq(marketplace.pendingRevenue(buyer), 0.942 ether);
    }

    function testPFPAllowlistBindsWalletPriceAndAllowance() public {
        BluePFP721 collection = _create(true, 5);
        uint256 allowance = 2;
        uint256 price = 0.005 ether;
        bytes32 root = controller.allowlistLeaf(address(collection), 1, 1, buyer, allowance, price, address(0));
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.MERKLE_ALLOWLIST,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0), mintPrice: uint128(price), startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days), phaseSupplyCap: 5,
            defaultWalletLimit: 0, maxPerTransaction: 2, merkleRoot: root
        });
        vm.prank(creator);
        uint256 phaseId = controller.createPhase(address(collection), 1, config);
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(buyer);
        controller.mintAllowlist{value: price * 2}(
            address(collection), 1, phaseId, 2, buyer, allowance, price, block.timestamp + 1 hours, proof
        );
        assertEq(collection.balanceOf(buyer), 2);
        vm.prank(buyer);
        vm.expectRevert(BlueDropController.WalletLimitExceeded.selector);
        controller.mintAllowlist{value: price}(
            address(collection), 1, phaseId, 1, buyer, allowance, price, block.timestamp + 1 hours, proof
        );
    }

    function testPFPTransferClearsApprovalAndReportsStandards() public {
        BluePFP721 collection = _create(true, 1);
        uint256 phaseId = _publicPhase(collection, 0, 1);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        assertTrue(collection.supportsInterface(0x80ac58cd));
        assertTrue(collection.supportsInterface(0x2a55205a));
        assertTrue(collection.supportsInterface(0x49064906));
        vm.prank(buyer);
        collection.approve(other, 1);
        vm.prank(other);
        collection.transferFrom(buyer, creator, 1);
        assertEq(collection.ownerOf(1), creator);
        assertEq(collection.getApproved(1), address(0));
    }

    function _create(bool revealed, uint256 supply) internal returns (BluePFP721 collection) {
        NFTPFPFactory.CreatePFPParams memory params = NFTPFPFactory.CreatePFPParams({
            name: "Blue PFP", symbol: "BPFP", contractURI: "ipfs://collection",
            baseURI: revealed ? "ipfs://metadata/" : "", placeholderURI: "ipfs://hidden",
            maxSupply: supply, provenanceHash: keccak256("metadata"), revealed: revealed,
            creatorReserve: 0, revealTime: 0, freezeOnReveal: false,
            royaltyRecipient: creator, royaltyBps: 500, salt: keccak256(abi.encode(supply, revealed))
        });
        uint256 launchFee = policy.collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = factory.createPFPCollection{value: launchFee}(params);
        collection = BluePFP721(deployed);
    }

    function testCreatorReserveCannotBeConsumedByPublicMintAndCanBeAirdropped() public {
        NFTPFPFactory.CreatePFPParams memory params = NFTPFPFactory.CreatePFPParams({
            name: "Reserved PFP", symbol: "RPFP", contractURI: "ipfs://collection", baseURI: "ipfs://metadata/",
            placeholderURI: "ipfs://hidden", maxSupply: 10, provenanceHash: keccak256("reserve"), revealed: true,
            creatorReserve: 3, revealTime: 0, freezeOnReveal: false,
            royaltyRecipient: creator, royaltyBps: 500, salt: keccak256("reserved")
        });
        uint256 launchFee = policy.collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = factory.createPFPCollection{value: launchFee}(params);
        BluePFP721 reserved = BluePFP721(deployed);
        uint256 phaseId = _publicPhase(reserved, 0, 10);
        vm.prank(buyer);
        controller.mintPublic(deployed, 1, phaseId, 7, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        vm.expectRevert(BluePFP721.SupplyExceeded.selector);
        controller.mintPublic(deployed, 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        address[] memory recipients = new address[](2); recipients[0] = creator; recipients[1] = buyer;
        uint256[] memory quantities = new uint256[](2); quantities[0] = 1; quantities[1] = 2;
        vm.prank(creator); reserved.airdrop(recipients, quantities);
        assertEq(reserved.totalLifetimeMinted(), 10);
        assertEq(reserved.creatorReserveRemaining(), 0);
    }

    function testScheduledRevealIsPermissionlessAfterDeadline() public {
        BluePFP721 collection = _create(false, 10);
        vm.prank(creator); collection.scheduleReveal("ipfs://future/", uint64(block.timestamp + 1 days), true);
        vm.expectRevert(BluePFP721.RevealTooEarly.selector); collection.executeScheduledReveal();
        vm.warp(block.timestamp + 1 days);
        vm.prank(other); collection.executeScheduledReveal();
        assertTrue(collection.revealed()); assertTrue(collection.metadataFrozen());
        assertEq(collection.scheduledRevealTime(), 0);
    }

    function _publicPhase(BluePFP721 collection, uint256 price, uint64 cap) internal returns (uint256 phaseId) {
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0), mintPrice: uint128(price), startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days), phaseSupplyCap: cap,
            defaultWalletLimit: cap == 0 ? 10 : uint32(cap), maxPerTransaction: cap == 0 ? 10 : uint32(cap), merkleRoot: bytes32(0)
        });
        vm.prank(creator);
        phaseId = controller.createPhase(address(collection), 1, config);
    }
}
