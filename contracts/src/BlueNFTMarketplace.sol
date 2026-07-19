// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "./interfaces/INFTCollectionRegistry.sol";
import {IERC1155Market} from "./interfaces/IERC1155Market.sol";

/// @notice Non-custodial fixed-price secondary market for BlueFun ERC-1155 editions.
/// @dev NFTs remain with the seller. Native proceeds use pull payments so a recipient cannot block a sale.
contract BlueNFTMarketplace is ReentrancyGuard {
    error InvalidAddress();
    error InvalidListing();
    error InvalidSchedule();
    error InvalidQuantity();
    error InvalidPayment();
    error NotSeller();
    error NotApproved();
    error InsufficientBalance();
    error FeeOverflow();
    error NativeTransferFailed();
    error NoRevenue();
    error MarketplacePaused();

    uint16 private constant BPS = 10_000;

    struct Listing {
        address seller;
        address collection;
        uint256 tokenId;
        uint128 unitPrice;
        uint64 startTime;
        uint64 endTime;
        uint64 remainingQuantity;
        bool cancelled;
    }

    INFTFeePolicy public immutable feePolicy;
    INFTCollectionRegistry public immutable collectionRegistry;
    uint256 public listingCount;
    uint256 public pendingPlatformRevenue;

    mapping(uint256 listingId => Listing listing) public listings;
    mapping(address recipient => uint256 amount) public pendingRevenue;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address indexed collection,
        uint256 tokenId,
        uint256 quantity,
        uint256 unitPrice,
        uint64 startTime,
        uint64 endTime
    );
    event ListingCancelled(uint256 indexed listingId, address indexed seller, uint256 remainingQuantity);
    event ListingPurchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed recipient,
        uint256 quantity,
        uint256 grossAmount,
        uint256 platformFee,
        address royaltyRecipient,
        uint256 royaltyAmount
    );
    event RevenueClaimed(address indexed recipient, uint256 amount);
    event PlatformRevenueFlushed(uint256 amount);

    constructor(INFTFeePolicy feePolicy_, INFTCollectionRegistry collectionRegistry_) {
        if (address(feePolicy_) == address(0) || address(collectionRegistry_) == address(0)) {
            revert InvalidAddress();
        }
        feePolicy = feePolicy_;
        collectionRegistry = collectionRegistry_;
    }

    function createListing(
        address collection,
        uint256 tokenId,
        uint64 quantity,
        uint128 unitPrice,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 listingId) {
        if (feePolicy.marketplacePaused()) revert MarketplacePaused();
        if (!collectionRegistry.isBlueFunCollection(collection)) revert InvalidListing();
        if (quantity == 0 || unitPrice == 0) revert InvalidQuantity();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidSchedule();
        IERC1155Market nft = IERC1155Market(collection);
        if (nft.balanceOf(msg.sender, tokenId) < quantity) revert InsufficientBalance();
        if (!nft.isApprovedForAll(msg.sender, address(this))) revert NotApproved();

        listingId = ++listingCount;
        listings[listingId] = Listing({
            seller: msg.sender,
            collection: collection,
            tokenId: tokenId,
            unitPrice: unitPrice,
            startTime: startTime,
            endTime: endTime,
            remainingQuantity: quantity,
            cancelled: false
        });
        emit ListingCreated(listingId, msg.sender, collection, tokenId, quantity, unitPrice, startTime, endTime);
    }

    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.cancelled || listing.remainingQuantity == 0) revert InvalidListing();
        listing.cancelled = true;
        emit ListingCancelled(listingId, msg.sender, listing.remainingQuantity);
    }

    function buy(uint256 listingId, uint64 quantity, address recipient) external payable nonReentrant {
        if (feePolicy.marketplacePaused()) revert MarketplacePaused();
        Listing storage listing = listings[listingId];
        if (listing.seller == address(0) || listing.cancelled) revert InvalidListing();
        if (
            recipient == address(0) || quantity == 0 || quantity > listing.remainingQuantity
                || recipient == listing.seller
        ) revert InvalidQuantity();
        if (block.timestamp < listing.startTime || block.timestamp >= listing.endTime) revert InvalidSchedule();

        uint256 gross = uint256(listing.unitPrice) * quantity;
        if (msg.value != gross) revert InvalidPayment();
        uint256 platformFee = (gross * feePolicy.marketplaceFeeBps()) / BPS;
        (address royaltyRecipient, uint256 royaltyAmount) =
            IERC1155Market(listing.collection).royaltyInfo(listing.tokenId, gross);
        if (royaltyRecipient == address(0)) royaltyAmount = 0;
        if (platformFee + royaltyAmount > gross) revert FeeOverflow();

        listing.remainingQuantity -= quantity;
        pendingPlatformRevenue += platformFee;
        pendingRevenue[listing.seller] += gross - platformFee - royaltyAmount;
        if (royaltyAmount != 0) pendingRevenue[royaltyRecipient] += royaltyAmount;

        IERC1155Market(listing.collection).safeTransferFrom(listing.seller, recipient, listing.tokenId, quantity, "");
        emit ListingPurchased(
            listingId, msg.sender, recipient, quantity, gross, platformFee, royaltyRecipient, royaltyAmount
        );
    }

    function claimRevenue() external nonReentrant returns (uint256 amount) {
        amount = pendingRevenue[msg.sender];
        if (amount == 0) revert NoRevenue();
        pendingRevenue[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit RevenueClaimed(msg.sender, amount);
    }

    function flushPlatformRevenue() external nonReentrant returns (uint256 amount) {
        amount = pendingPlatformRevenue;
        if (amount == 0) revert NoRevenue();
        pendingPlatformRevenue = 0;
        (bool ok,) = payable(feePolicy.platformWallet()).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit PlatformRevenueFlushed(amount);
    }
}
