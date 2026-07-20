// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "./interfaces/INFTCollectionRegistry.sol";
import {IERC20Offers} from "./interfaces/IERC20Offers.sol";
import {IERC721Market} from "./interfaces/IERC721Market.sol";
import {IERC1155Market} from "./interfaces/IERC1155Market.sol";

interface IERC1271Offers {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}

/// @notice Non-custodial WETH item and collection offers for registered BlueFun NFTs.
/// @dev Makers retain their WETH until a seller accepts a signed EIP-712 offer.
contract BlueNFTOffers is ReentrancyGuard {
    error InvalidAddress();
    error InvalidOffer();
    error InvalidSchedule();
    error InvalidQuantity();
    error InvalidSignature();
    error InvalidNonce();
    error InvalidStandard();
    error InvalidCollection();
    error NotTaker();
    error NotOwner();
    error NotApproved();
    error FeeOverflow();
    error TransferFailed();
    error InsufficientSellerProceeds(uint256 actual, uint256 minimum);
    error InvalidMinimumSellerProceeds();
    error LegacyEntryPointDisabled();
    error MarketplacePaused();

    uint16 private constant BPS = 10_000;
    uint8 public constant STANDARD_ERC721 = 1;
    uint8 public constant STANDARD_ERC1155 = 2;
    uint8 public constant OFFER_ITEM = 0;
    uint8 public constant OFFER_COLLECTION = 1;
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;
    uint256 private constant SECP256K1N_DIV_2 = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant OFFER_TYPEHASH = keccak256(
        "Offer(address maker,address taker,address recipient,address collection,uint256 tokenId,uint128 unitPrice,uint64 quantity,uint64 startTime,uint64 endTime,uint256 nonce,uint8 standard,uint8 offerType)"
    );
    bytes32 private constant NAME_HASH = keccak256("BlueFun NFT Offers");
    bytes32 private constant VERSION_HASH = keccak256("1");

    struct Offer {
        address maker;
        address taker;
        address recipient;
        address collection;
        uint256 tokenId;
        uint128 unitPrice;
        uint64 quantity;
        uint64 startTime;
        uint64 endTime;
        uint256 nonce;
        uint8 standard;
        uint8 offerType;
    }

    INFTFeePolicy public immutable feePolicy;
    INFTCollectionRegistry public immutable editionRegistry;
    INFTCollectionRegistry public immutable pfpRegistry;
    IERC20Offers public immutable weth;

    mapping(bytes32 offerHash => uint64 quantity) public filledQuantity;
    mapping(bytes32 offerHash => bool cancelled) public cancelledOffers;
    mapping(address maker => uint256 nonce) public minimumNonce;

    event OfferCancelled(bytes32 indexed offerHash, address indexed maker, uint256 nonce);
    event AllOffersCancelled(address indexed maker, uint256 previousMinimumNonce, uint256 newMinimumNonce);
    event OfferAccepted(
        bytes32 indexed offerHash,
        address indexed maker,
        address indexed seller,
        address collection,
        uint256 tokenId,
        uint256 quantity,
        uint256 grossAmount,
        uint256 platformFee,
        address royaltyRecipient,
        uint256 royaltyAmount,
        uint8 standard,
        uint8 offerType
    );

    constructor(
        INFTFeePolicy feePolicy_,
        INFTCollectionRegistry editionRegistry_,
        INFTCollectionRegistry pfpRegistry_,
        IERC20Offers weth_
    ) {
        if (
            address(feePolicy_) == address(0) || address(editionRegistry_) == address(0)
                || address(pfpRegistry_) == address(0) || address(weth_) == address(0)
        ) revert InvalidAddress();
        feePolicy = feePolicy_;
        editionRegistry = editionRegistry_;
        pfpRegistry = pfpRegistry_;
        weth = weth_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashOffer(Offer calldata offer) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), _hashOfferStruct(offer)));
    }

    function remainingQuantity(Offer calldata offer) external view returns (uint64) {
        bytes32 digest = hashOffer(offer);
        uint64 filled = filledQuantity[digest];
        return offer.quantity > filled ? offer.quantity - filled : 0;
    }

    function cancelOffer(Offer calldata offer) external {
        if (offer.maker != msg.sender) revert InvalidOffer();
        bytes32 digest = hashOffer(offer);
        if (cancelledOffers[digest] || filledQuantity[digest] >= offer.quantity) revert InvalidOffer();
        cancelledOffers[digest] = true;
        emit OfferCancelled(digest, msg.sender, offer.nonce);
    }

    function cancelAllOffers(uint256 newMinimumNonce) external {
        uint256 previous = minimumNonce[msg.sender];
        if (newMinimumNonce <= previous) revert InvalidNonce();
        minimumNonce[msg.sender] = newMinimumNonce;
        emit AllOffersCancelled(msg.sender, previous, newMinimumNonce);
    }

    function acceptOffer(Offer calldata, uint256, uint64, bytes calldata) external pure {
        revert LegacyEntryPointDisabled();
    }

    /// @notice Accepts an offer only when current platform and royalty deductions preserve the seller's quote.
    function acceptOfferWithMinProceeds(
        Offer calldata offer,
        uint256 tokenId,
        uint64 quantity,
        bytes calldata signature,
        uint256 minimumSellerProceeds
    ) external nonReentrant {
        if (minimumSellerProceeds == 0) revert InvalidMinimumSellerProceeds();
        _acceptOffer(offer, tokenId, quantity, signature, minimumSellerProceeds);
    }

    function _acceptOffer(
        Offer calldata offer,
        uint256 tokenId,
        uint64 quantity,
        bytes calldata signature,
        uint256 minimumSellerProceeds
    ) private {
        if (feePolicy.marketplacePaused()) revert MarketplacePaused();
        bytes32 digest = hashOffer(offer);
        _validateOffer(offer, digest, tokenId, quantity, signature);

        uint64 filled = filledQuantity[digest];
        if (quantity > offer.quantity - filled) revert InvalidQuantity();
        filledQuantity[digest] = filled + quantity;

        uint256 gross = uint256(offer.unitPrice) * quantity;
        uint256 platformFee = (gross * feePolicy.marketplaceFeeBps()) / BPS;
        (address royaltyRecipient, uint256 royaltyAmount) = _royaltyInfo(offer, tokenId, gross);
        if (royaltyRecipient == address(0)) royaltyAmount = 0;
        if (platformFee + royaltyAmount > gross) revert FeeOverflow();

        uint256 sellerProceeds = gross - platformFee - royaltyAmount;
        if (sellerProceeds < minimumSellerProceeds) {
            revert InsufficientSellerProceeds(sellerProceeds, minimumSellerProceeds);
        }
        _safeTransferFrom(offer.maker, msg.sender, sellerProceeds);
        if (platformFee != 0) _safeTransferFrom(offer.maker, feePolicy.platformWallet(), platformFee);
        if (royaltyAmount != 0) _safeTransferFrom(offer.maker, royaltyRecipient, royaltyAmount);
        _transferNFT(offer, tokenId, quantity);

        emit OfferAccepted(
            digest,
            offer.maker,
            msg.sender,
            offer.collection,
            tokenId,
            quantity,
            gross,
            platformFee,
            royaltyRecipient,
            royaltyAmount,
            offer.standard,
            offer.offerType
        );
    }

    function isOfferValid(Offer calldata offer, bytes calldata signature)
        external
        view
        returns (bool valid, uint64 remaining)
    {
        bytes32 digest = hashOffer(offer);
        uint64 filled = filledQuantity[digest];
        remaining = offer.quantity > filled ? offer.quantity - filled : 0;
        valid = !feePolicy.marketplacePaused() && _wellFormedOffer(offer) && remaining != 0 && !cancelledOffers[digest]
            && offer.nonce >= minimumNonce[offer.maker] && block.timestamp >= offer.startTime
            && block.timestamp < offer.endTime && _validCollection(offer)
            && _isValidSignature(offer.maker, digest, signature);
    }

    /// @notice Separates signature validity from the maker's current WETH funding state.
    function isOfferExecutable(Offer calldata offer, bytes calldata signature, uint64 quantity)
        external
        view
        returns (bool executable, uint256 requiredAmount, uint256 balance, uint256 allowance)
    {
        bytes32 digest = hashOffer(offer);
        uint64 filled = filledQuantity[digest];
        uint64 remaining = offer.quantity > filled ? offer.quantity - filled : 0;
        if (
            quantity == 0 || quantity > remaining || feePolicy.marketplacePaused() || !_wellFormedOffer(offer)
                || cancelledOffers[digest] || offer.nonce < minimumNonce[offer.maker]
                || block.timestamp < offer.startTime || block.timestamp >= offer.endTime
                || !_isValidSignature(offer.maker, digest, signature)
        ) return (false, 0, 0, 0);
        if (offer.standard == STANDARD_ERC721 && quantity != 1) return (false, 0, 0, 0);
        requiredAmount = uint256(offer.unitPrice) * quantity;
        balance = weth.balanceOf(offer.maker);
        allowance = weth.allowance(offer.maker, address(this));
        executable = balance >= requiredAmount && allowance >= requiredAmount;
    }

    function _wellFormedOffer(Offer calldata offer) private view returns (bool) {
        if (
            offer.maker == address(0) || offer.recipient == address(0) || offer.collection == address(0)
                || offer.unitPrice == 0 || offer.quantity == 0 || offer.endTime <= offer.startTime
        ) return false;
        if (offer.offerType == OFFER_ITEM) {
            if (offer.standard == STANDARD_ERC721 && offer.quantity != 1) return false;
        } else if (offer.offerType == OFFER_COLLECTION) {
            if (offer.tokenId != 0) return false;
        } else {
            return false;
        }
        return _validCollection(offer);
    }

    function _validateOffer(
        Offer calldata offer,
        bytes32 digest,
        uint256 tokenId,
        uint64 quantity,
        bytes calldata signature
    ) private view {
        if (
            offer.maker == address(0) || offer.recipient == address(0) || offer.collection == address(0)
                || offer.maker == msg.sender || offer.unitPrice == 0 || offer.quantity == 0
        ) revert InvalidOffer();
        if (offer.taker != address(0) && offer.taker != msg.sender) revert NotTaker();
        if (offer.endTime <= offer.startTime || block.timestamp < offer.startTime || block.timestamp >= offer.endTime) {
            revert InvalidSchedule();
        }
        if (offer.nonce < minimumNonce[offer.maker] || cancelledOffers[digest]) revert InvalidNonce();
        if (!_validCollection(offer)) revert InvalidCollection();
        if (offer.offerType == OFFER_ITEM) {
            if (offer.tokenId != tokenId) revert InvalidOffer();
        } else if (offer.offerType == OFFER_COLLECTION) {
            if (offer.tokenId != 0) revert InvalidOffer();
        } else {
            revert InvalidOffer();
        }
        if (quantity == 0) revert InvalidQuantity();
        if (offer.standard == STANDARD_ERC721) {
            if (quantity != 1 || (offer.offerType == OFFER_ITEM && offer.quantity != 1)) revert InvalidQuantity();
        } else if (offer.standard != STANDARD_ERC1155) {
            revert InvalidStandard();
        }
        if (!_isValidSignature(offer.maker, digest, signature)) revert InvalidSignature();
    }

    function _validCollection(Offer calldata offer) private view returns (bool) {
        if (offer.standard == STANDARD_ERC721) return pfpRegistry.isBlueFunCollection(offer.collection);
        if (offer.standard == STANDARD_ERC1155) return editionRegistry.isBlueFunCollection(offer.collection);
        return false;
    }

    function _transferNFT(Offer calldata offer, uint256 tokenId, uint64 quantity) private {
        if (offer.standard == STANDARD_ERC721) {
            IERC721Market nft = IERC721Market(offer.collection);
            if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner();
            if (nft.getApproved(tokenId) != address(this) && !nft.isApprovedForAll(msg.sender, address(this))) {
                revert NotApproved();
            }
            nft.safeTransferFrom(msg.sender, offer.recipient, tokenId);
        } else {
            IERC1155Market nft = IERC1155Market(offer.collection);
            if (nft.balanceOf(msg.sender, tokenId) < quantity) revert NotOwner();
            if (!nft.isApprovedForAll(msg.sender, address(this))) revert NotApproved();
            nft.safeTransferFrom(msg.sender, offer.recipient, tokenId, quantity, "");
        }
    }

    function _royaltyInfo(Offer calldata offer, uint256 tokenId, uint256 gross)
        private
        view
        returns (address recipient, uint256 amount)
    {
        if (offer.standard == STANDARD_ERC721) return IERC721Market(offer.collection).royaltyInfo(tokenId, gross);
        return IERC1155Market(offer.collection).royaltyInfo(tokenId, gross);
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool success, bytes memory result) =
            address(weth).call(abi.encodeCall(IERC20Offers.transferFrom, (from, to, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }

    function _hashOfferStruct(Offer calldata offer) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OFFER_TYPEHASH,
                offer.maker,
                offer.taker,
                offer.recipient,
                offer.collection,
                offer.tokenId,
                offer.unitPrice,
                offer.quantity,
                offer.startTime,
                offer.endTime,
                offer.nonce,
                offer.standard,
                offer.offerType
            )
        );
    }

    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature) private view returns (bool) {
        if (signer.code.length != 0) {
            (bool success, bytes memory result) =
                signer.staticcall(abi.encodeCall(IERC1271Offers.isValidSignature, (digest, signature)));
            return success && result.length >= 32 && bytes4(result) == ERC1271_MAGICVALUE;
        }
        return _recover(digest, signature) == signer;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        if (signature.length == 65) {
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 32))
                v := byte(0, calldataload(add(signature.offset, 64)))
            }
        } else if (signature.length == 64) {
            bytes32 vs;
            assembly {
                r := calldataload(signature.offset)
                vs := calldataload(add(signature.offset, 32))
            }
            s = vs & bytes32(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
            v = uint8((uint256(vs) >> 255) + 27);
        } else {
            return address(0);
        }
        if (uint256(s) > SECP256K1N_DIV_2 || (v != 27 && v != 28)) return address(0);
        signer = ecrecover(digest, v, r, s);
    }
}
