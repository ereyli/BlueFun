// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {NFTFeePolicy} from "../src/NFTFeePolicy.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BluePFP721} from "../src/BluePFP721.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BlueNFTMarketplace721} from "../src/BlueNFTMarketplace721.sol";
import {MockWETH} from "./mocks/MockWETH.sol";

contract PFPRejectingPlatformWallet {
    receive() external payable {
        revert();
    }

    function acceptPlatformWallet(NFTFeePolicy policy) external {
        policy.acceptPlatformWallet();
    }
}

contract NFTPFPLaunchpadTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal buyer = address(0xB0B);
    address internal other = address(0xCAFE);
    address payable internal platformWallet = payable(address(0xB1E));

    NFTFeePolicy internal policy;
    BlueDropController internal controller;
    NFTPFPFactory internal factory;
    BlueNFTMarketplace721 internal marketplace;
    MockWETH internal weth;

    function setUp() public {
        policy = new NFTFeePolicy(address(this), address(this), platformWallet);
        weth = new MockWETH();
        controller = new BlueDropController(policy, address(weth), address(this));
        factory = new NFTPFPFactory(policy, address(controller), address(weth));
        controller.configureFactories(address(factory), address(factory));
        marketplace = new BlueNFTMarketplace721(policy, factory, address(weth));
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
        assertTrue(controller.registeredCollection(address(collection)));
    }

    function testPFPLaunchFeeFallsBackToWETH() public {
        PFPRejectingPlatformWallet rejectingWallet = new PFPRejectingPlatformWallet();
        policy.proposePlatformWallet(payable(address(rejectingWallet)));
        rejectingWallet.acceptPlatformWallet(policy);
        BluePFP721 collection = _create(false, 10);
        assertTrue(factory.isBlueFunCollection(address(collection)));
        assertEq(weth.balanceOf(address(rejectingWallet)), policy.collectionLaunchFee());
        assertEq(address(factory).balance, 0);
    }

    function testPFPPhaseRejectsUnboundedBatchMint() public {
        BluePFP721 collection = _create(false, 101);
        vm.expectRevert(BlueDropController.InvalidQuantity.selector);
        _publicPhase(collection, 0, 101);
    }

    function testControllerMintsSequentialUniqueTokens() public {
        BluePFP721 collection = _create(true, 3);
        uint256 phaseId = _publicPhase(collection, 0.01 ether, 3);
        uint256 creatorBefore = creator.balance;
        uint256 platformBefore = platformWallet.balance;
        vm.prank(buyer);
        controller.mintPublic{value: 0.02 ether}(
            address(collection), 1, phaseId, 2, buyer, 0.01 ether, block.timestamp + 1 hours
        );
        assertEq(collection.ownerOf(1), buyer);
        assertEq(collection.ownerOf(2), buyer);
        assertEq(collection.balanceOf(buyer), 2);
        assertEq(collection.totalLifetimeMinted(), 2);
        assertEq(address(controller).balance, 0);
        assertEq(creator.balance, creatorBefore + 0.0196 ether);
        assertEq(platformWallet.balance, platformBefore + 0.0004 ether);
        assertEq(address(controller).balance, 0);
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
        uint256 sellerBefore = buyer.balance;
        uint256 creatorBefore = creator.balance;
        uint256 platformBefore = platformWallet.balance;
        vm.prank(other);
        marketplace.buy{value: 1 ether}(listingId, other);
        assertEq(collection.ownerOf(1), other);
        assertEq(address(marketplace).balance, 0);
        assertEq(buyer.balance, sellerBefore + 0.942 ether);
        assertEq(creator.balance, creatorBefore + 0.05 ether);
        assertEq(platformWallet.balance, platformBefore + 0.008 ether);
        assertEq(address(marketplace).balance, 0);
    }

    function testPFPAllowlistBindsWalletPriceAndAllowance() public {
        BluePFP721 collection = _create(true, 5);
        uint256 allowance = 2;
        uint256 price = 0.005 ether;
        bytes32 root = controller.allowlistLeaf(address(collection), 1, 1, buyer, allowance, price, address(0));
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.MERKLE_ALLOWLIST,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: uint128(price),
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            phaseSupplyCap: 5,
            defaultWalletLimit: 0,
            maxPerTransaction: 2,
            merkleRoot: root
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
            name: "Blue PFP",
            symbol: "BPFP",
            contractURI: "ipfs://collection",
            baseURI: revealed ? "ipfs://metadata/" : "",
            placeholderURI: "ipfs://hidden",
            maxSupply: supply,
            provenanceHash: keccak256("metadata"),
            revealed: revealed,
            creatorReserve: 0,
            revealTime: 0,
            freezeOnReveal: false,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256(abi.encode(supply, revealed))
        });
        uint256 launchFee = policy.collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = factory.createPFPCollection{value: launchFee}(params);
        collection = BluePFP721(deployed);
    }

    function testCreatorReserveCannotBeConsumedByPublicMintAndCanBeAirdropped() public {
        NFTPFPFactory.CreatePFPParams memory params = NFTPFPFactory.CreatePFPParams({
            name: "Reserved PFP",
            symbol: "RPFP",
            contractURI: "ipfs://collection",
            baseURI: "ipfs://metadata/",
            placeholderURI: "ipfs://hidden",
            maxSupply: 10,
            provenanceHash: keccak256("reserve"),
            revealed: true,
            creatorReserve: 3,
            revealTime: 0,
            freezeOnReveal: false,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256("reserved")
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
        address[] memory recipients = new address[](2);
        recipients[0] = creator;
        recipients[1] = buyer;
        uint256[] memory quantities = new uint256[](2);
        quantities[0] = 1;
        quantities[1] = 2;
        vm.prank(creator);
        reserved.airdrop(recipients, quantities);
        assertEq(reserved.totalLifetimeMinted(), 10);
        assertEq(reserved.creatorReserveRemaining(), 0);
    }

    function testScheduledRevealIsPermissionlessAfterDeadline() public {
        BluePFP721 collection = _create(false, 10);
        string memory revealURI = "ipfs://future/";
        bytes32 secretSalt = bytes32(uint256(0xA11CE));
        vm.prank(creator);
        collection.scheduleReveal(keccak256(abi.encode(revealURI, secretSalt)), uint64(block.timestamp + 1 days), true);
        vm.expectRevert(BluePFP721.RevealTooEarly.selector);
        collection.executeScheduledReveal(revealURI, secretSalt);
        vm.warp(block.timestamp + 1 days);
        vm.prank(other);
        collection.executeScheduledReveal(revealURI, secretSalt);
        assertTrue(collection.revealed());
        assertTrue(collection.metadataFrozen());
        assertEq(collection.scheduledRevealTime(), 0);
    }

    function testScheduledRevealCannotBeBypassedOrChangedAfterMint() public {
        BluePFP721 collection = _create(false, 10);
        string memory revealURI = "ipfs://locked/";
        bytes32 secretSalt = bytes32(uint256(0xB10E));
        vm.prank(creator);
        collection.scheduleReveal(keccak256(abi.encode(revealURI, secretSalt)), uint64(block.timestamp + 1 days), true);
        uint256 phaseId = _publicPhase(collection, 0, 1);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);

        vm.prank(creator);
        vm.expectRevert(BluePFP721.ScheduledRevealRequired.selector);
        collection.reveal("ipfs://different/", false);
        vm.prank(creator);
        vm.expectRevert(BluePFP721.RevealScheduleLocked.selector);
        collection.cancelScheduledReveal();
        vm.prank(creator);
        vm.expectRevert(BluePFP721.RevealScheduleLocked.selector);
        collection.scheduleReveal(keccak256("replacement"), uint64(block.timestamp + 2 days), false);

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(BluePFP721.InvalidRevealProof.selector);
        collection.executeScheduledReveal(revealURI, bytes32(uint256(0xBAD)));
        collection.executeScheduledReveal(revealURI, secretSalt);
        assertTrue(collection.revealed());
        assertTrue(collection.metadataFrozen());
    }

    function testRevealCommitmentIsDomainSeparatedPerCollection() public {
        BluePFP721 first = _create(false, 10);
        BluePFP721 second = _create(false, 11);
        bytes32 innerCommitment = keccak256(abi.encode("ipfs://same/", bytes32(uint256(0xCAFE))));

        vm.startPrank(creator);
        first.scheduleReveal(innerCommitment, uint64(block.timestamp + 1 days), true);
        second.scheduleReveal(innerCommitment, uint64(block.timestamp + 1 days), true);
        vm.stopPrank();

        assertTrue(first.scheduledRevealCommitment() != second.scheduledRevealCommitment());
        assertEq(uint256(first.scheduledRevealCommitment()), uint256(first.revealCommitmentFor(innerCommitment)));
        assertEq(uint256(second.scheduledRevealCommitment()), uint256(second.revealCommitmentFor(innerCommitment)));
    }

    function testFactoryScheduledRevealStoresDomainSeparatedCommitment() public {
        string memory revealURI = "ipfs://future/";
        bytes32 secretSalt = 0x1111111111111111111111111111111111111111111111111111111111111111;
        NFTPFPFactory.CreatePFPParams memory params = NFTPFPFactory.CreatePFPParams({
            name: "Committed PFP",
            symbol: "CPFP",
            contractURI: "ipfs://collection",
            baseURI: "0x3ab50d19f2aebc38fe3096f10006c9290053bb21e44ee63118117d29a6b128cd",
            placeholderURI: "ipfs://hidden",
            maxSupply: 10,
            provenanceHash: keccak256("provenance"),
            revealed: false,
            creatorReserve: 0,
            revealTime: uint64(block.timestamp + 1 days),
            freezeOnReveal: true,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256("committed-reveal")
        });
        vm.prank(creator);
        (, address deployed) = factory.createPFPCollection{value: policy.collectionLaunchFee()}(params);
        BluePFP721 collection = BluePFP721(deployed);

        assertEq(bytes(collection.baseURI()).length, 0);
        bytes32 innerCommitment = keccak256(abi.encode(revealURI, secretSalt));
        assertEq(
            uint256(collection.scheduledRevealCommitment()), uint256(collection.revealCommitmentFor(innerCommitment))
        );
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(BluePFP721.InvalidRevealProof.selector);
        collection.executeScheduledReveal("ipfs://wrong/", secretSalt);
        vm.prank(other);
        collection.executeScheduledReveal(revealURI, secretSalt);
        assertTrue(collection.revealed());
    }

    function _publicPhase(BluePFP721 collection, uint256 price, uint64 cap) internal returns (uint256 phaseId) {
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: uint128(price),
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            phaseSupplyCap: cap,
            defaultWalletLimit: cap == 0 ? 10 : uint32(cap),
            maxPerTransaction: cap == 0 ? 10 : uint32(cap),
            merkleRoot: bytes32(0)
        });
        vm.prank(creator);
        phaseId = controller.createPhase(address(collection), 1, config);
    }
}
