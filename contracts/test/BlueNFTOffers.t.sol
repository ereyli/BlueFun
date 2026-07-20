// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {BlueNFTOffers} from "../src/BlueNFTOffers.sol";
import {NFTFeePolicy} from "../src/NFTFeePolicy.sol";
import {NFTCollectionFactory} from "../src/NFTCollectionFactory.sol";
import {NFTPFPFactory} from "../src/NFTPFPFactory.sol";
import {BlueDropController} from "../src/BlueDropController.sol";
import {BlueEdition1155} from "../src/BlueEdition1155.sol";
import {BluePFP721} from "../src/BluePFP721.sol";
import {IERC20Offers} from "../src/interfaces/IERC20Offers.sol";

contract MockWETHOffers is IERC20Offers {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount || balanceOf[from] < amount) return false;
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Mock1271OfferWallet {
    bytes32 public approvedDigest;
    bytes public approvedSignature;

    function approveDigest(bytes32 digest, bytes calldata signature) external {
        approvedDigest = digest;
        approvedSignature = signature;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        return digest == approvedDigest && keccak256(signature) == keccak256(approvedSignature)
            ? bytes4(0x1626ba7e)
            : bytes4(0xffffffff);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }
}

contract BlueNFTOffersTest is Test {
    uint256 internal constant MAKER_KEY = 0xA11CE123;
    address internal maker;
    address internal creator = address(0xC0FFEE);
    address internal seller = address(0xB0B);
    address internal secondSeller = address(0xCAFE);
    address internal restrictedSeller = address(0xD00D);
    address payable internal platformWallet = payable(address(0xB1E));

    NFTFeePolicy internal policy;
    BlueDropController internal controller;
    NFTCollectionFactory internal editionFactory;
    NFTPFPFactory internal pfpFactory;
    MockWETHOffers internal weth;
    BlueNFTOffers internal offers;

    function setUp() public {
        maker = vm.addr(MAKER_KEY);
        policy = new NFTFeePolicy(address(this), address(this), platformWallet);
        weth = new MockWETHOffers();
        controller = new BlueDropController(policy, address(weth), address(this));
        editionFactory = new NFTCollectionFactory(policy, address(controller), address(weth));
        pfpFactory = new NFTPFPFactory(policy, address(controller), address(weth));
        controller.configureFactories(address(editionFactory), address(pfpFactory));
        offers = new BlueNFTOffers(policy, editionFactory, pfpFactory, weth);
        vm.deal(creator, 10 ether);
        weth.mint(maker, 100 ether);
        vm.prank(maker);
        weth.approve(address(offers), type(uint256).max);
    }

    function testERC721ItemOfferSettlesWETHPlatformAndRoyalty() public {
        BluePFP721 collection = _createPFP(2);
        _mintPFP(collection, seller, 1);
        vm.prank(seller);
        collection.approve(address(offers), 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 1);

        bytes memory signature = _sign(offer);
        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 0.942 ether);

        assertEq(collection.ownerOf(1), maker);
        assertEq(weth.balanceOf(seller), 0.942 ether);
        assertEq(weth.balanceOf(creator), 0.05 ether);
        assertEq(weth.balanceOf(platformWallet), 0.008 ether);
        assertEq(offers.filledQuantity(offers.hashOffer(offer)), 1);
    }

    function testSellerCanProtectMinimumOfferProceeds() public {
        BluePFP721 collection = _createPFP(2);
        _mintPFP(collection, seller, 1);
        vm.prank(seller);
        collection.approve(address(offers), 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 77);
        bytes memory signature = _sign(offer);

        vm.prank(seller);
        vm.expectRevert();
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 0.95 ether);

        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 0.942 ether);
        assertEq(collection.ownerOf(1), maker);
    }

    function testLegacyAcceptanceIsDisabledAndZeroMinimumIsRejected() public {
        BluePFP721 collection = _createPFP(1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 78);
        bytes memory signature = _sign(offer);
        vm.expectRevert(BlueNFTOffers.LegacyEntryPointDisabled.selector);
        offers.acceptOffer(offer, 1, 1, signature);
        vm.expectRevert(BlueNFTOffers.InvalidMinimumSellerProceeds.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 0);
    }

    function testExecutableOfferReportsCurrentWETHFunding() public {
        BluePFP721 collection = _createPFP(1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 79);
        bytes memory signature = _sign(offer);
        (bool executable, uint256 requiredAmount, uint256 balance, uint256 allowance) =
            offers.isOfferExecutable(offer, signature, 1);
        assertTrue(executable);
        assertEq(requiredAmount, 1 ether);
        assertEq(balance, 100 ether);
        assertEq(allowance, type(uint256).max);

        vm.prank(maker);
        weth.approve(address(offers), 0);
        (executable, requiredAmount, balance, allowance) = offers.isOfferExecutable(offer, signature, 1);
        assertFalse(executable);
        assertEq(requiredAmount, 1 ether);
        assertEq(balance, 100 ether);
        assertEq(allowance, 0);
    }

    function testERC721CollectionOfferCanFillDifferentTokenIds() public {
        BluePFP721 collection = _createPFP(2);
        _mintPFP(collection, seller, 2);
        vm.prank(seller);
        collection.safeTransferFrom(seller, secondSeller, 2);
        vm.prank(seller);
        collection.approve(address(offers), 1);
        vm.prank(secondSeller);
        collection.approve(address(offers), 2);
        BlueNFTOffers.Offer memory offer = _offer(
            address(collection), 0, 0.2 ether, 2, offers.STANDARD_ERC721(), offers.OFFER_COLLECTION(), address(0), 2
        );
        bytes memory signature = _sign(offer);

        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
        vm.prank(secondSeller);
        offers.acceptOfferWithMinProceeds(offer, 2, 1, signature, 1);

        assertEq(collection.ownerOf(1), maker);
        assertEq(collection.ownerOf(2), maker);
        assertEq(offers.filledQuantity(offers.hashOffer(offer)), 2);
        vm.prank(secondSeller);
        vm.expectRevert(BlueNFTOffers.InvalidQuantity.selector);
        offers.acceptOfferWithMinProceeds(offer, 2, 1, signature, 1);
    }

    function testERC1155OfferSupportsAtomicPartialFills() public {
        BlueEdition1155 collection = _createEdition(10);
        _mintEdition(collection, seller, 5);
        vm.prank(seller);
        collection.setApprovalForAll(address(offers), true);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 0.1 ether, 5, offers.STANDARD_ERC1155(), offers.OFFER_ITEM(), address(0), 3);
        bytes memory signature = _sign(offer);

        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, 2, signature, 1);
        assertEq(collection.balanceOf(maker, 1), 2);
        assertEq(offers.filledQuantity(offers.hashOffer(offer)), 2);
        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, 3, signature, 1);
        assertEq(collection.balanceOf(maker, 1), 5);
        assertEq(offers.filledQuantity(offers.hashOffer(offer)), 5);
        assertEq(weth.balanceOf(seller), 0.471 ether);
    }

    function testRestrictedTakerIsEnforced() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        vm.prank(seller);
        collection.approve(address(offers), 1);
        BlueNFTOffers.Offer memory offer = _offer(
            address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), restrictedSeller, 4
        );
        bytes memory signature = _sign(offer);
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.NotTaker.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
    }

    function testInvalidSignatureAndModifiedPriceAreRejected() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        vm.prank(seller);
        collection.approve(address(offers), 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 5);
        bytes memory signature = _sign(offer);
        offer.unitPrice = 2 ether;
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.InvalidSignature.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
    }

    function testIndividualCancellationPreventsAcceptance() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 6);
        bytes memory signature = _sign(offer);
        vm.prank(maker);
        offers.cancelOffer(offer);
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.InvalidNonce.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
    }

    function testCancelAllInvalidatesEveryLowerNonce() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 7);
        bytes memory signature = _sign(offer);
        vm.prank(maker);
        offers.cancelAllOffers(8);
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.InvalidNonce.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
    }

    function testExpiredAndFutureOffersAreRejected() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 9);
        offer.startTime = uint64(block.timestamp + 1 hours);
        offer.endTime = uint64(block.timestamp + 2 hours);
        bytes memory signature = _sign(offer);
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.InvalidSchedule.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
    }

    function testPauseBlocksAcceptanceButCancellationRemainsAvailable() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 10);
        bytes memory signature = _sign(offer);
        policy.pauseMarketplace();
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.MarketplacePaused.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
        vm.prank(maker);
        offers.cancelOffer(offer);
    }

    function testWrongRegistryStandardIsRejected() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC1155(), offers.OFFER_ITEM(), address(0), 11);
        bytes memory signature = _sign(offer);
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.InvalidCollection.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
    }

    function testMissingNFTApprovalRollsBackWETHSettlement() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 12);
        bytes memory signature = _sign(offer);
        uint256 makerBefore = weth.balanceOf(maker);
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.NotApproved.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
        assertEq(weth.balanceOf(maker), makerBefore);
        assertEq(weth.balanceOf(seller), 0);
        assertEq(offers.filledQuantity(offers.hashOffer(offer)), 0);
    }

    function testFuzzERC1155FillCannotExceedSignedQuantity(uint8 rawQuantity, uint8 rawFill) public {
        uint64 quantity = uint64((uint256(rawQuantity) % 20) + 1);
        uint64 fill = uint64((uint256(rawFill) % quantity) + 1);
        BlueEdition1155 collection = _createEdition(quantity);
        _mintEdition(collection, seller, quantity);
        vm.prank(seller);
        collection.setApprovalForAll(address(offers), true);
        BlueNFTOffers.Offer memory offer = _offer(
            address(collection), 1, 1 gwei, quantity, offers.STANDARD_ERC1155(), offers.OFFER_ITEM(), address(0), 13
        );
        bytes memory signature = _sign(offer);
        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, fill, signature, 1);
        assertEq(offers.filledQuantity(offers.hashOffer(offer)), fill);
        uint64 excessive = quantity - fill + 1;
        vm.prank(seller);
        vm.expectRevert(BlueNFTOffers.InvalidQuantity.selector);
        offers.acceptOfferWithMinProceeds(offer, 1, excessive, signature, 1);
    }

    function testERC1271ContractWalletOfferIsAccepted() public {
        BluePFP721 collection = _createPFP(1);
        _mintPFP(collection, seller, 1);
        vm.prank(seller);
        collection.approve(address(offers), 1);
        Mock1271OfferWallet contractMaker = new Mock1271OfferWallet();
        weth.mint(address(contractMaker), 2 ether);
        vm.prank(address(contractMaker));
        weth.approve(address(offers), type(uint256).max);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 1, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 14);
        offer.maker = address(contractMaker);
        offer.recipient = address(contractMaker);
        bytes memory signature = hex"1234567890";
        contractMaker.approveDigest(offers.hashOffer(offer), signature);
        vm.prank(seller);
        offers.acceptOfferWithMinProceeds(offer, 1, 1, signature, 1);
        assertEq(collection.ownerOf(1), address(contractMaker));
    }

    function testIsOfferValidRejectsMalformedOffer() public {
        BluePFP721 collection = _createPFP(1);
        BlueNFTOffers.Offer memory offer =
            _offer(address(collection), 1, 1 ether, 2, offers.STANDARD_ERC721(), offers.OFFER_ITEM(), address(0), 15);
        bytes memory signature = _sign(offer);
        (bool valid, uint64 remaining) = offers.isOfferValid(offer, signature);
        assertFalse(valid);
        assertEq(remaining, 2);
    }

    function _offer(
        address collection,
        uint256 tokenId,
        uint128 unitPrice,
        uint64 quantity,
        uint8 standard,
        uint8 offerType,
        address taker,
        uint256 nonce
    ) internal view returns (BlueNFTOffers.Offer memory) {
        return BlueNFTOffers.Offer({
            maker: maker,
            taker: taker,
            recipient: maker,
            collection: collection,
            tokenId: tokenId,
            unitPrice: unitPrice,
            quantity: quantity,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 7 days),
            nonce: nonce,
            standard: standard,
            offerType: offerType
        });
    }

    function _sign(BlueNFTOffers.Offer memory offer) internal returns (bytes memory signature) {
        bytes32 digest = offers.hashOffer(offer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_KEY, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _createPFP(uint256 supply) internal returns (BluePFP721 collection) {
        NFTPFPFactory.CreatePFPParams memory params = NFTPFPFactory.CreatePFPParams({
            name: "Offer PFP",
            symbol: "OPFP",
            contractURI: "ipfs://collection",
            baseURI: "ipfs://tokens/",
            placeholderURI: "ipfs://hidden",
            maxSupply: supply,
            provenanceHash: keccak256("offers"),
            revealed: true,
            creatorReserve: 0,
            revealTime: 0,
            freezeOnReveal: false,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256(abi.encode("pfp", supply))
        });
        uint256 launchFee = policy.collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = pfpFactory.createPFPCollection{value: launchFee}(params);
        collection = BluePFP721(deployed);
    }

    function _createEdition(uint256 supply) internal returns (BlueEdition1155 collection) {
        NFTCollectionFactory.CreateCollectionParams memory params = NFTCollectionFactory.CreateCollectionParams({
            name: "Offer Edition",
            symbol: "OED",
            contractURI: "ipfs://collection",
            initialItemURI: "ipfs://item",
            initialMaxSupply: supply,
            initialCreatorReserve: 0,
            royaltyRecipient: creator,
            royaltyBps: 500,
            salt: keccak256(abi.encode("edition", supply, block.timestamp))
        });
        uint256 launchFee = policy.collectionLaunchFee();
        vm.prank(creator);
        (, address deployed) = editionFactory.createCollection{value: launchFee}(params);
        collection = BlueEdition1155(deployed);
    }

    function _mintPFP(BluePFP721 collection, address recipient, uint64 quantity) internal {
        uint256 phaseId = _publicPhase(address(collection), quantity);
        vm.prank(recipient);
        controller.mintPublic(address(collection), 1, phaseId, quantity, recipient, 0, block.timestamp + 1 hours);
    }

    function _mintEdition(BlueEdition1155 collection, address recipient, uint64 quantity) internal {
        uint256 phaseId = _publicPhase(address(collection), quantity);
        vm.prank(recipient);
        controller.mintPublic(address(collection), 1, phaseId, quantity, recipient, 0, block.timestamp + 1 hours);
    }

    function _publicPhase(address collection, uint64 quantity) internal returns (uint256 phaseId) {
        BlueDropController.PhaseConfig memory config = BlueDropController.PhaseConfig({
            phaseType: BlueDropController.PhaseType.PUBLIC,
            limitMode: BlueDropController.LimitMode.PER_PHASE,
            currency: address(0),
            mintPrice: 0,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 1 days),
            phaseSupplyCap: quantity,
            defaultWalletLimit: uint32(quantity),
            maxPerTransaction: uint32(quantity),
            merkleRoot: bytes32(0)
        });
        vm.prank(creator);
        phaseId = controller.createPhase(collection, 1, config);
    }
}
