// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "./interfaces/INFTCollectionRegistry.sol";
import {IERC721Market} from "./interfaces/IERC721Market.sol";
import {NativeSettlement} from "./libraries/NativeSettlement.sol";

/// @notice Non-custodial fixed-price market for BlueFun PFP collections.
contract BlueNFTMarketplace721 is ReentrancyGuard {
    error InvalidAddress();
    error InvalidListing();
    error InvalidSchedule();
    error InvalidPayment();
    error NotSeller();
    error NotApproved();
    error FeeOverflow();
    error FeeTermsChanged();
    error NoRevenue();
    error NativeTransferFailed();
    error MarketplacePaused();

    uint16 private constant BPS = 10_000;

    struct Listing {
        address seller;
        address collection;
        uint256 tokenId;
        uint128 price;
        uint64 startTime;
        uint64 endTime;
        bool cancelled;
        bool sold;
    }

    INFTFeePolicy public immutable feePolicy;
    INFTCollectionRegistry public immutable collectionRegistry;
    address public immutable weth;
    uint256 public listingCount;
    /// @dev Deprecated V2 accounting slots. New settlements never accrue balances here.
    uint256 public pendingPlatformRevenue;
    mapping(uint256 listingId => Listing listing) public listings;
    mapping(uint256 listingId => uint16 bps) public maximumMarketplaceFeeBps;
    mapping(uint256 listingId => uint16 bps) public maximumRoyaltyBps;
    mapping(address recipient => uint256 amount) public pendingRevenue;

    event ListingCreated(uint256 indexed listingId, address indexed seller, address indexed collection, uint256 tokenId, uint256 price, uint64 startTime, uint64 endTime);
    event ListingCancelled(uint256 indexed listingId, address indexed seller);
    event ListingPurchased(uint256 indexed listingId, address indexed buyer, address indexed recipient, uint256 grossAmount, uint256 platformFee, address royaltyRecipient, uint256 royaltyAmount);
    event RevenueClaimed(address indexed recipient, uint256 amount);
    event PlatformRevenueFlushed(uint256 amount);
    event AutomaticPayout(address indexed recipient, uint256 amount, bool paidAsWETH);

    constructor(INFTFeePolicy feePolicy_, INFTCollectionRegistry registry_, address weth_) {
        if (address(feePolicy_) == address(0) || address(registry_) == address(0)) revert InvalidAddress();
        NativeSettlement.validate(weth_);
        feePolicy = feePolicy_;
        collectionRegistry = registry_;
        weth = weth_;
    }

    function createListing(address collection, uint256 tokenId, uint128 price, uint64 startTime, uint64 endTime)
        external returns (uint256 listingId)
    {
        if (feePolicy.marketplacePaused()) revert MarketplacePaused();
        if (!collectionRegistry.isBlueFunCollection(collection) || price == 0) revert InvalidListing();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidSchedule();
        IERC721Market nft = IERC721Market(collection);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotSeller();
        if (nft.getApproved(tokenId) != address(this) && !nft.isApprovedForAll(msg.sender, address(this))) revert NotApproved();
        listingId = ++listingCount;
        listings[listingId] = Listing(msg.sender, collection, tokenId, price, startTime, endTime, false, false);
        (, uint256 royaltyBps) = nft.royaltyInfo(tokenId, BPS);
        if (royaltyBps > BPS) revert FeeOverflow();
        maximumMarketplaceFeeBps[listingId] = feePolicy.marketplaceFeeBps();
        maximumRoyaltyBps[listingId] = uint16(royaltyBps);
        emit ListingCreated(listingId, msg.sender, collection, tokenId, price, startTime, endTime);
    }

    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (listing.cancelled || listing.sold) revert InvalidListing();
        listing.cancelled = true;
        emit ListingCancelled(listingId, msg.sender);
    }

    function buy(uint256 listingId, address recipient) external payable nonReentrant {
        if (feePolicy.marketplacePaused()) revert MarketplacePaused();
        Listing storage listing = listings[listingId];
        if (listing.seller == address(0) || listing.cancelled || listing.sold || recipient == address(0) || recipient == listing.seller) revert InvalidListing();
        if (block.timestamp < listing.startTime || block.timestamp >= listing.endTime) revert InvalidSchedule();
        if (msg.value != listing.price) revert InvalidPayment();
        IERC721Market nft = IERC721Market(listing.collection);
        if (nft.ownerOf(listing.tokenId) != listing.seller) revert InvalidListing();

        uint16 marketplaceFeeBps = feePolicy.marketplaceFeeBps();
        if (marketplaceFeeBps > maximumMarketplaceFeeBps[listingId]) revert FeeTermsChanged();
        uint256 platformFee = (uint256(listing.price) * marketplaceFeeBps) / BPS;
        (address royaltyRecipient, uint256 royaltyAmount) = nft.royaltyInfo(listing.tokenId, listing.price);
        if (royaltyRecipient == address(0)) royaltyAmount = 0;
        if (royaltyAmount > (uint256(listing.price) * maximumRoyaltyBps[listingId]) / BPS) {
            revert FeeTermsChanged();
        }
        if (platformFee + royaltyAmount > listing.price) revert FeeOverflow();
        listing.sold = true;
        nft.safeTransferFrom(listing.seller, recipient, listing.tokenId);
        _payout(listing.seller, uint256(listing.price) - platformFee - royaltyAmount);
        if (royaltyAmount != 0) _payout(royaltyRecipient, royaltyAmount);
        if (platformFee != 0) _payout(feePolicy.platformWallet(), platformFee);
        emit ListingPurchased(listingId, msg.sender, recipient, listing.price, platformFee, royaltyRecipient, royaltyAmount);
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

    function _payout(address recipient, uint256 amount) private {
        bool paidAsWETH = NativeSettlement.pay(weth, recipient, amount);
        emit AutomaticPayout(recipient, amount, paidAsWETH);
    }
}
