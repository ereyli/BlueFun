// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {NFTFeePolicy} from "../src/NFTFeePolicy.sol";
import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {BlueEdition1155} from "../src/BlueEdition1155.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BlueNFTMarketplace} from "../src/BlueNFTMarketplace.sol";

contract RevertingNativeReceiver {
    receive() external payable {
        revert();
    }
}

contract RejectingERC1155Receiver {}

contract StateChangingTransferValidator {
    uint256 public calls;

    function validateTransfer(address, address, address, uint256, uint256) external {
        ++calls;
    }
}

contract NFTLaunchpadTest is Test {
    address internal guardian = address(0xA11CE);
    address internal creator = address(0xC0FFEE);
    address internal buyer = address(0xB0B);
    address internal other = address(0xCAFE);
    address payable internal platformWallet = payable(address(0xB1E));

    NFTFeePolicy internal policy;
    BlueDropController internal controller;
    NFTCollectionFactory internal factory;
    BlueNFTMarketplace internal marketplace;

    function setUp() public {
        policy = new NFTFeePolicy(address(this), guardian, platformWallet);
        controller = new BlueDropController(policy);
        factory = new NFTCollectionFactory(policy, address(controller));
        marketplace = new BlueNFTMarketplace(policy, factory);
        vm.deal(platformWallet, 0);
        vm.deal(creator, 20 ether);
        vm.deal(buyer, 20 ether);
        vm.deal(other, 20 ether);
    }

    function testCollectionLaunchRequiresExactFeeAndCreatorOwnsCollection() public {
        NFTCollectionFactory.CreateCollectionParams memory params = _collectionParams("exact");
        address predicted = factory.predictCollectionAddress(creator, params);

        vm.prank(creator);
        vm.expectRevert();
        factory.createCollection{value: 0.0009 ether}(params);

        vm.prank(creator);
        vm.expectRevert();
        factory.createCollection{value: 0.0011 ether}(params);

        vm.prank(creator);
        (uint256 collectionId, address collection) = factory.createCollection{value: 0.001 ether}(params);

        assertEq(collectionId, 1);
        assertEq(collection, predicted);
        assertEq(BlueEdition1155(collection).owner(), creator);
        assertEq(BlueEdition1155(collection).originalCreator(), creator);
        assertEq(BlueEdition1155(collection).payoutRecipient(), creator);
        assertEq(BlueEdition1155(collection).maxSupply(1), 1_000);
        assertEq(platformWallet.balance, 0.001 ether);
        assertTrue(factory.isBlueFunCollection(collection));
    }

    function testFreePublicMintTakesNoPrimaryFee() public {
        BlueEdition1155 collection = _createCollection("free");
        uint256 phaseId = _createPublicPhase(collection, 0, 2, 10, BlueDropController.LimitMode.PER_PHASE);

        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 2, buyer, 0, block.timestamp + 1 hours);

        assertEq(collection.balanceOf(buyer, 1), 2);
        assertEq(controller.pendingCreatorRevenue(address(collection)), 0);
        assertEq(controller.pendingPlatformRevenue(), 0);
    }

    function testPaidPublicMintSplitsTwoPercentAndClaimsArePullBased() public {
        BlueEdition1155 collection = _createCollection("paid");
        uint256 phaseId = _createPublicPhase(collection, 0.1 ether, 3, 100, BlueDropController.LimitMode.PER_PHASE);
        uint256 creatorBefore = creator.balance;
        uint256 platformBefore = platformWallet.balance;

        vm.prank(buyer);
        controller.mintPublic{value: 0.2 ether}(
            address(collection), 1, phaseId, 2, buyer, 0.1 ether, block.timestamp + 1 hours
        );

        assertEq(controller.pendingCreatorRevenue(address(collection)), 0.196 ether);
        assertEq(controller.pendingPlatformRevenue(), 0.004 ether);
        assertEq(collection.balanceOf(buyer, 1), 2);

        controller.claimCreatorRevenue(address(collection));
        assertEq(creator.balance, creatorBefore + 0.196 ether);
        controller.flushPlatformRevenue();
        assertEq(platformWallet.balance, platformBefore + 0.004 ether);
    }

    function testRevertingCreatorPayoutCannotBlockMintOrLosePendingRevenue() public {
        BlueEdition1155 collection = _createCollection("reverting-payout");
        RevertingNativeReceiver rejectingRecipient = new RevertingNativeReceiver();
        vm.prank(creator);
        collection.setPayoutRecipient(address(rejectingRecipient));
        uint256 phaseId = _createPublicPhase(collection, 0.1 ether, 1, 1, BlueDropController.LimitMode.PER_PHASE);

        vm.prank(buyer);
        controller.mintPublic{value: 0.1 ether}(
            address(collection), 1, phaseId, 1, buyer, 0.1 ether, block.timestamp + 1 hours
        );
        assertEq(collection.balanceOf(buyer, 1), 1);
        assertEq(controller.pendingCreatorRevenue(address(collection)), 0.098 ether);

        vm.expectRevert(BlueDropController.NativeTransferFailed.selector);
        controller.claimCreatorRevenue(address(collection));
        assertEq(controller.pendingCreatorRevenue(address(collection)), 0.098 ether);

        vm.prank(creator);
        collection.setPayoutRecipient(creator);
        uint256 creatorBefore = creator.balance;
        controller.claimCreatorRevenue(address(collection));
        assertEq(creator.balance, creatorBefore + 0.098 ether);
    }

    function testAllowlistSupportsCustomWalletPriceAndLimit() public {
        BlueEdition1155 collection = _createCollection("wl");
        uint256 phaseId = 1;
        uint256 allowance = 3;
        uint256 customPrice = 0.02 ether;
        bytes32 leaf =
            controller.allowlistLeaf(address(collection), 1, phaseId, buyer, allowance, customPrice, address(0));
        BlueDropController.PhaseConfig memory config = _phaseConfig(
            BlueDropController.PhaseType.MERKLE_ALLOWLIST, BlueDropController.LimitMode.PER_PHASE, 0.5 ether, 0, 3, leaf
        );
        vm.prank(creator);
        controller.createPhase(address(collection), 1, config);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(buyer);
        controller.mintAllowlist{value: 0.06 ether}(
            address(collection), 1, phaseId, 3, buyer, allowance, customPrice, block.timestamp + 1 hours, proof
        );

        assertEq(collection.balanceOf(buyer, 1), 3);
        assertEq(controller.pendingCreatorRevenue(address(collection)), 0.0588 ether);
        assertEq(controller.pendingPlatformRevenue(), 0.0012 ether);

        vm.prank(buyer);
        vm.expectRevert(BlueDropController.WalletLimitExceeded.selector);
        controller.mintAllowlist{value: customPrice}(
            address(collection), 1, phaseId, 1, buyer, allowance, customPrice, block.timestamp + 1 hours, proof
        );
    }

    function testInvalidAllowlistProofIsRejected() public {
        BlueEdition1155 collection = _createCollection("bad-proof");
        bytes32 root = controller.allowlistLeaf(address(collection), 1, 1, buyer, 2, 0, address(0));
        BlueDropController.PhaseConfig memory config = _phaseConfig(
            BlueDropController.PhaseType.MERKLE_ALLOWLIST, BlueDropController.LimitMode.PER_PHASE, 0, 0, 2, root
        );
        vm.prank(creator);
        controller.createPhase(address(collection), 1, config);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(other);
        vm.expectRevert(BlueDropController.InvalidProof.selector);
        controller.mintAllowlist(address(collection), 1, 1, 1, other, 2, 0, block.timestamp + 1 hours, proof);
    }

    function testPublicWalletAndPhaseSupplyLimitsAreEnforced() public {
        BlueEdition1155 collection = _createCollection("limits");
        uint256 phaseId = _createPublicPhase(collection, 0, 2, 3, BlueDropController.LimitMode.PER_PHASE);

        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 2, buyer, 0, block.timestamp + 1 hours);

        vm.prank(buyer);
        vm.expectRevert(BlueDropController.WalletLimitExceeded.selector);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);

        vm.prank(other);
        vm.expectRevert(BlueDropController.PhaseSupplyExceeded.selector);
        controller.mintPublic(address(collection), 1, phaseId, 2, other, 0, block.timestamp + 1 hours);
    }

    function testCumulativeLimitIncludesPriorPhases() public {
        BlueEdition1155 collection = _createCollection("cumulative");
        uint256 first = _createPublicPhase(collection, 0, 2, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, first, 2, buyer, 0, block.timestamp + 1 hours);
        vm.warp(block.timestamp + 1 days);

        uint256 second = _createPublicPhase(collection, 0, 3, 10, BlueDropController.LimitMode.CUMULATIVE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, second, 1, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        vm.expectRevert(BlueDropController.WalletLimitExceeded.selector);
        controller.mintPublic(address(collection), 1, second, 1, buyer, 0, block.timestamp + 1 hours);
    }

    function testSupplyCannotIncreaseAfterFirstMintAndBurnDoesNotReopenSupply() public {
        NFTCollectionFactory.CreateCollectionParams memory params = _collectionParams("supply");
        params.initialMaxSupply = 2;
        BlueEdition1155 collection = _createCollectionWithParams(params);
        uint256 phaseId = _createPublicPhase(collection, 0, 2, 2, BlueDropController.LimitMode.PER_PHASE);

        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 2, buyer, 0, block.timestamp + 1 hours);

        vm.prank(creator);
        vm.expectRevert(BlueEdition1155.SupplyIncreaseAfterMint.selector);
        collection.setMaxSupply(1, 3);

        vm.prank(buyer);
        collection.burn(buyer, 1, 1);
        assertEq(collection.totalSupply(1), 1);
        assertEq(collection.lifetimeMinted(1), 2);

        vm.prank(creator);
        collection.createItem("ipfs://second", 1);
        assertEq(collection.maxSupply(2), 1);
    }

    function testRoyaltyCannotIncreaseAfterMintAndCanBeFrozen() public {
        BlueEdition1155 collection = _createCollection("royalty");
        uint256 phaseId = _createPublicPhase(collection, 0, 1, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);

        vm.prank(creator);
        vm.expectRevert(BlueEdition1155.RoyaltyIncreaseAfterMint.selector);
        collection.setRoyalty(creator, 600);

        vm.prank(creator);
        collection.setRoyalty(creator, 400);
        (address recipient, uint256 amount) = collection.royaltyInfo(1, 1 ether);
        assertEq(recipient, creator);
        assertEq(amount, 0.04 ether);

        vm.prank(creator);
        collection.freezeRoyalty();
        vm.prank(creator);
        vm.expectRevert(BlueEdition1155.RoyaltyFrozen.selector);
        collection.setRoyalty(creator, 300);
    }

    function testTransferValidatorCannotMutateStateOrReenterCollection() public {
        BlueEdition1155 collection = _createCollection("validator-staticcall");
        uint256 phaseId = _createPublicPhase(collection, 0, 1, 1, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);

        StateChangingTransferValidator validator = new StateChangingTransferValidator();
        vm.prank(creator);
        collection.setTransferValidator(address(validator));

        vm.prank(buyer);
        vm.expectRevert(BlueEdition1155.TransferRejected.selector);
        collection.safeTransferFrom(buyer, other, 1, 1, "");
        assertEq(collection.balanceOf(buyer, 1), 1);
        assertEq(collection.balanceOf(other, 1), 0);
        assertEq(validator.calls(), 0);
    }

    function testGuardianCanPauseCollectionsAndMintsIndependently() public {
        vm.prank(guardian);
        policy.pauseNewCollections();
        vm.prank(creator);
        vm.expectRevert(NFTCollectionFactory.CollectionsPaused.selector);
        factory.createCollection{value: 0.001 ether}(_collectionParams("paused"));

        policy.unpauseNewCollections();
        BlueEdition1155 collection = _createCollection("mint-pause");
        uint256 phaseId = _createPublicPhase(collection, 0, 1, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(guardian);
        policy.pauseNewMints();
        vm.prank(buyer);
        vm.expectRevert(BlueDropController.MintsPaused.selector);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
    }

    function testPolicyFeeBounds() public {
        policy.setCollectionLaunchFee(0.005 ether);
        assertEq(policy.collectionLaunchFee(), 0.005 ether);
        vm.expectRevert(NFTFeePolicy.InvalidFee.selector);
        policy.setCollectionLaunchFee(0.010000000000000001 ether);

        policy.setPlatformFees(400, 50);
        assertEq(policy.primaryMintFeeBps(), 400);
        assertEq(policy.marketplaceFeeBps(), 50);
        vm.expectRevert(NFTFeePolicy.InvalidFee.selector);
        policy.setPlatformFees(501, 50);
        vm.expectRevert(NFTFeePolicy.InvalidFee.selector);
        policy.setPlatformFees(400, 101);
    }

    function testSinglePlatformWalletCanAdminPauseUnpauseAndReceiveRevenue() public {
        NFTFeePolicy singleWalletPolicy = new NFTFeePolicy(platformWallet, platformWallet, platformWallet);

        vm.startPrank(platformWallet);
        singleWalletPolicy.setCollectionLaunchFee(0.002 ether);
        singleWalletPolicy.setPlatformFees(250, 90);
        singleWalletPolicy.pauseNewCollections();
        singleWalletPolicy.unpauseNewCollections();
        singleWalletPolicy.pauseNewMints();
        singleWalletPolicy.unpauseNewMints();
        singleWalletPolicy.pauseMarketplace();
        singleWalletPolicy.unpauseMarketplace();
        vm.stopPrank();

        assertEq(singleWalletPolicy.admin(), platformWallet);
        assertEq(singleWalletPolicy.guardian(), platformWallet);
        assertEq(singleWalletPolicy.platformWallet(), platformWallet);
        assertEq(singleWalletPolicy.collectionLaunchFee(), 0.002 ether);
        assertEq(singleWalletPolicy.primaryMintFeeBps(), 250);
        assertEq(singleWalletPolicy.marketplaceFeeBps(), 90);
        assertFalse(singleWalletPolicy.newCollectionsPaused());
        assertFalse(singleWalletPolicy.newMintsPaused());
        assertFalse(singleWalletPolicy.marketplacePaused());
    }

    function testPlatformRevenueWalletCanRotateWithoutRedeployingNFTContracts() public {
        address payable replacement = payable(address(0xFEE));
        vm.deal(replacement, 0);
        policy.setPlatformWallet(replacement);

        _createCollection("rotated-platform-wallet");

        assertEq(policy.platformWallet(), replacement);
        assertEq(replacement.balance, 0.001 ether);
        assertEq(platformWallet.balance, 0);
    }

    function testFuzzPaidMintAlwaysSplitsExactlyConfiguredFee(uint96 rawPrice, uint8 rawQuantity) public {
        uint256 price = (uint256(rawPrice) % 1 ether) + 1;
        uint256 quantity = (uint256(rawQuantity) % 10) + 1;
        BlueEdition1155 collection = _createCollection("fuzz-fee");
        uint256 phaseId = _createPublicPhase(
            collection, price, uint32(quantity), uint64(quantity), BlueDropController.LimitMode.PER_PHASE
        );
        uint256 gross = price * quantity;
        vm.deal(buyer, gross);

        vm.prank(buyer);
        controller.mintPublic{value: gross}(
            address(collection), 1, phaseId, quantity, buyer, price, block.timestamp + 1 hours
        );

        uint256 expectedFee = (gross * policy.primaryMintFeeBps()) / 10_000;
        assertEq(controller.pendingPlatformRevenue(), expectedFee);
        assertEq(controller.pendingCreatorRevenue(address(collection)), gross - expectedFee);
        assertEq(collection.balanceOf(buyer, 1), quantity);
    }

    function testCreatorOwnershipTransferIsTwoStep() public {
        BlueEdition1155 collection = _createCollection("ownership");
        vm.prank(creator);
        collection.proposeOwner(other);
        vm.prank(buyer);
        vm.expectRevert(BlueEdition1155.NotPendingOwner.selector);
        collection.acceptOwner();
        vm.prank(other);
        collection.acceptOwner();
        assertEq(collection.owner(), other);
        assertEq(collection.originalCreator(), creator);
    }

    function testSecondarySaleSplitsMarketplaceFeeRoyaltyAndSellerRevenue() public {
        BlueEdition1155 collection = _createCollection("secondary");
        uint256 phaseId = _createPublicPhase(collection, 0, 2, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 2, buyer, 0, block.timestamp + 1 hours);

        vm.prank(buyer);
        collection.setApprovalForAll(address(marketplace), true);
        vm.prank(buyer);
        uint256 listingId = marketplace.createListing(
            address(collection), 1, 2, 1 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );

        vm.prank(other);
        marketplace.buy{value: 1 ether}(listingId, 1, other);

        assertEq(collection.balanceOf(other, 1), 1);
        assertEq(marketplace.pendingPlatformRevenue(), 0.008 ether);
        assertEq(marketplace.pendingRevenue(creator), 0.05 ether);
        assertEq(marketplace.pendingRevenue(buyer), 0.942 ether);

        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        marketplace.claimRevenue();
        assertEq(buyer.balance, buyerBefore + 0.942 ether);
        uint256 platformBefore = platformWallet.balance;
        marketplace.flushPlatformRevenue();
        assertEq(platformWallet.balance, platformBefore + 0.008 ether);
    }

    function testSecondaryListingCanBePartiallyFilledAndCancelled() public {
        BlueEdition1155 collection = _createCollection("partial");
        uint256 phaseId = _createPublicPhase(collection, 0, 3, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 3, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        collection.setApprovalForAll(address(marketplace), true);
        vm.prank(buyer);
        uint256 listingId = marketplace.createListing(
            address(collection), 1, 3, 0.1 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );

        vm.prank(other);
        marketplace.buy{value: 0.2 ether}(listingId, 2, other);
        (,,,,,, uint64 remaining,) = marketplace.listings(listingId);
        assertEq(remaining, 1);

        vm.prank(buyer);
        marketplace.cancelListing(listingId);
        vm.prank(other);
        vm.expectRevert(BlueNFTMarketplace.InvalidListing.selector);
        marketplace.buy{value: 0.1 ether}(listingId, 1, other);
    }

    function testRejectingERC1155RecipientRevertsPurchaseAndAllAccounting() public {
        BlueEdition1155 collection = _createCollection("rejecting-recipient");
        uint256 phaseId = _createPublicPhase(collection, 0, 1, 1, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        collection.setApprovalForAll(address(marketplace), true);
        vm.prank(buyer);
        uint256 listingId = marketplace.createListing(
            address(collection), 1, 1, 1 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );
        RejectingERC1155Receiver rejectingRecipient = new RejectingERC1155Receiver();

        vm.prank(other);
        vm.expectRevert(BlueEdition1155.InvalidReceiver.selector);
        marketplace.buy{value: 1 ether}(listingId, 1, address(rejectingRecipient));

        (,,,,,, uint64 remaining, bool cancelled) = marketplace.listings(listingId);
        assertEq(remaining, 1);
        assertFalse(cancelled);
        assertEq(marketplace.pendingPlatformRevenue(), 0);
        assertEq(marketplace.pendingRevenue(buyer), 0);
        assertEq(marketplace.pendingRevenue(creator), 0);
        assertEq(collection.balanceOf(buyer, 1), 1);
    }

    function testGuardianCanPauseMarketplaceWithoutBlockingCancellation() public {
        BlueEdition1155 collection = _createCollection("market-pause");
        uint256 phaseId = _createPublicPhase(collection, 0, 1, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        collection.setApprovalForAll(address(marketplace), true);
        vm.prank(buyer);
        uint256 listingId = marketplace.createListing(
            address(collection), 1, 1, 0.1 ether, uint64(block.timestamp), uint64(block.timestamp + 1 days)
        );

        vm.prank(guardian);
        policy.pauseMarketplace();
        vm.prank(other);
        vm.expectRevert(BlueNFTMarketplace.MarketplacePaused.selector);
        marketplace.buy{value: 0.1 ether}(listingId, 1, other);
        vm.prank(buyer);
        marketplace.cancelListing(listingId);
    }

    function testCreatorCanCancelAllowlistEvenWhenPublicPhaseIsAlreadyQueued() public {
        BlueEdition1155 collection = _createCollection("cancel-queued-wl");
        uint64 allowlistStart = uint64(block.timestamp + 1 hours);
        bytes32 root = keccak256("allowlist-root");
        BlueDropController.PhaseConfig memory allowlist = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.MERKLE_ALLOWLIST,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: 0,
            startTime: allowlistStart,
            endTime: allowlistStart + 1 hours,
            phaseSupplyCap: 100,
            defaultWalletLimit: 0,
            maxPerTransaction: 5,
            merkleRoot: root
        });
        BlueDropController.PhaseConfig memory publicPhase = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: 0,
            startTime: allowlist.endTime,
            endTime: allowlist.endTime + 1 days,
            phaseSupplyCap: 100,
            defaultWalletLimit: 2,
            maxPerTransaction: 5,
            merkleRoot: bytes32(0)
        });

        vm.startPrank(creator);
        uint256 allowlistId = controller.createPhase(address(collection), 1, allowlist);
        uint256 publicId = controller.createPhase(address(collection), 1, publicPhase);
        controller.cancelPhase(address(collection), 1, allowlistId);
        vm.stopPrank();

        (,,,,,,,,,,, bool cancelled) = controller.phases(address(collection), 1, allowlistId);
        assertTrue(cancelled);
        (,,,,,,,,,, uint64 publicPreviousEnd,) = controller.phases(address(collection), 1, publicId);
        assertEq(publicPreviousEnd, 0);

        vm.warp(publicPhase.startTime);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, publicId, 1, buyer, 0, block.timestamp + 1 hours);
        assertEq(collection.balanceOf(buyer, 1), 1);
    }

    function testCreatorCanEditQueuedAllowlistWithoutOverlappingPublicPhase() public {
        BlueEdition1155 collection = _createCollection("edit-queued-wl");
        uint64 allowlistStart = uint64(block.timestamp + 1 hours);
        BlueDropController.PhaseConfig memory allowlist = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.MERKLE_ALLOWLIST,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: 0,
            startTime: allowlistStart,
            endTime: allowlistStart + 1 hours,
            phaseSupplyCap: 100,
            defaultWalletLimit: 0,
            maxPerTransaction: 5,
            merkleRoot: keccak256("editable-root")
        });
        BlueDropController.PhaseConfig memory publicPhase = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: 0,
            startTime: allowlistStart + 3 hours,
            endTime: allowlistStart + 3 hours + 1 days,
            phaseSupplyCap: 100,
            defaultWalletLimit: 2,
            maxPerTransaction: 5,
            merkleRoot: bytes32(0)
        });

        vm.startPrank(creator);
        uint256 allowlistId = controller.createPhase(address(collection), 1, allowlist);
        controller.createPhase(address(collection), 1, publicPhase);
        allowlist.endTime = allowlistStart + 2 hours;
        controller.updatePhase(address(collection), 1, allowlistId, allowlist);
        allowlist.endTime = publicPhase.startTime + 1;
        vm.expectRevert(BlueDropController.InvalidSchedule.selector);
        controller.updatePhase(address(collection), 1, allowlistId, allowlist);
        vm.stopPrank();

        (,,,,, uint64 updatedEnd,,,,,,) = controller.phases(address(collection), 1, allowlistId);
        assertEq(updatedEnd, allowlistStart + 2 hours);
    }

    function testEditingSkipsCancelledPhasesButStillProtectsTheNextLivePhase() public {
        BlueEdition1155 collection = _createCollection("cancelled-phase-linking");
        uint64 start = uint64(block.timestamp + 1 hours);
        BlueDropController.PhaseConfig memory first = _scheduledPublic(start, start + 1 hours);
        BlueDropController.PhaseConfig memory middle = _scheduledPublic(start + 2 hours, start + 3 hours);
        BlueDropController.PhaseConfig memory last = _scheduledPublic(start + 4 hours, start + 5 hours);

        vm.startPrank(creator);
        uint256 firstId = controller.createPhase(address(collection), 1, first);
        uint256 middleId = controller.createPhase(address(collection), 1, middle);
        uint256 lastId = controller.createPhase(address(collection), 1, last);
        controller.cancelPhase(address(collection), 1, middleId);
        first.endTime = last.startTime + 1;
        vm.expectRevert(BlueDropController.InvalidSchedule.selector);
        controller.updatePhase(address(collection), 1, firstId, first);
        controller.cancelPhase(address(collection), 1, lastId);
        first.endTime = start + 8 hours;
        controller.updatePhase(address(collection), 1, firstId, first);
        vm.stopPrank();

        assertEq(controller.lastPhaseEnd(address(collection), 1), start + 8 hours);
    }

    function _createCollection(string memory salt) internal returns (BlueEdition1155 collection) {
        collection = _createCollectionWithParams(_collectionParams(salt));
    }

    function _createCollectionWithParams(NFTCollectionFactory.CreateCollectionParams memory params)
        internal
        returns (BlueEdition1155 collection)
    {
        uint256 launchFee = policy.collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = factory.createCollection{value: launchFee}(params);
        collection = BlueEdition1155(deployed);
    }

    function _createPublicPhase(
        BlueEdition1155 collection,
        uint256 price,
        uint32 walletLimit,
        uint64 phaseCap,
        BlueDropController.LimitMode limitMode
    ) internal returns (uint256 phaseId) {
        uint64 start = uint64(block.timestamp);
        uint64 priorEnd = controller.lastPhaseEnd(address(collection), 1);
        if (priorEnd > start) start = priorEnd;
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: limitMode,
            currency: address(0),
            mintPrice: uint128(price),
            startTime: start,
            endTime: start + 1 days,
            phaseSupplyCap: phaseCap,
            defaultWalletLimit: walletLimit,
            maxPerTransaction: 10,
            merkleRoot: bytes32(0)
        });
        vm.prank(creator);
        phaseId = controller.createPhase(address(collection), 1, config);
    }

    function _phaseConfig(
        BlueDropController.PhaseType phaseType,
        BlueDropController.LimitMode limitMode,
        uint256 price,
        uint64 phaseCap,
        uint32 walletLimit,
        bytes32 root
    ) internal view returns (BlueDropController.PhaseConfig memory) {
        return BlueDropController.PhaseConfig({
            phaseType: phaseType,
            limitMode: limitMode,
            currency: address(0),
            mintPrice: uint128(price),
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            phaseSupplyCap: phaseCap,
            defaultWalletLimit: walletLimit,
            maxPerTransaction: 10,
            merkleRoot: root
        });
    }

    function _scheduledPublic(uint64 start, uint64 end)
        internal
        pure
        returns (BlueDropController.PhaseConfig memory)
    {
        return BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: 0,
            startTime: start,
            endTime: end,
            phaseSupplyCap: 100,
            defaultWalletLimit: 2,
            maxPerTransaction: 5,
            merkleRoot: bytes32(0)
        });
    }

    function _collectionParams(string memory salt)
        internal
        view
        returns (NFTCollectionFactory.CreateCollectionParams memory)
    {
        return NFTCollectionFactory.CreateCollectionParams({
            name: "Blue Editions",
            symbol: "BED",
            contractURI: "ipfs://collection",
            initialItemURI: "ipfs://item-1",
            initialMaxSupply: 1_000,
            initialCreatorReserve: 0,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256(bytes(salt))
        });
    }

    function testEditionReserveProtectedAndAirdropConsumesIt() public {
        NFTCollectionFactory.CreateCollectionParams memory params = _collectionParams("reserve");
        params.initialMaxSupply = 10;
        params.initialCreatorReserve = 3;
        BlueEdition1155 collection = _createCollectionWithParams(params);
        uint256 phaseId = _createPublicPhase(collection, 0, 10, 10, BlueDropController.LimitMode.PER_PHASE);
        vm.prank(buyer);
        controller.mintPublic(address(collection), 1, phaseId, 7, buyer, 0, block.timestamp + 1 hours);
        vm.prank(buyer);
        vm.expectRevert(BlueEdition1155.SupplyExceeded.selector);
        controller.mintPublic(address(collection), 1, phaseId, 1, buyer, 0, block.timestamp + 1 hours);
        address[] memory recipients = new address[](1); recipients[0] = creator;
        uint256[] memory quantities = new uint256[](1); quantities[0] = 3;
        vm.prank(creator); collection.airdrop(1, recipients, quantities);
        assertEq(collection.lifetimeMinted(1), 10);
        assertEq(collection.creatorReserveRemaining(1), 0);
    }
}
