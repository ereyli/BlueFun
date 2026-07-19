// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {BlueEdition1155} from "./BlueEdition1155.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "./interfaces/INFTCollectionRegistry.sol";

/// @notice Permissionless creator-owned ERC-1155 collection factory for BlueFun NFT launches.
contract NFTCollectionFactory is ReentrancyGuard, INFTCollectionRegistry {
    error InvalidConfig();
    error IncorrectLaunchFee(uint256 supplied, uint256 required);
    error CollectionsPaused();
    error PlatformTransferFailed();

    struct CreateCollectionParams {
        string name;
        string symbol;
        string contractURI;
        string initialItemURI;
        uint256 initialMaxSupply;
        uint256 initialCreatorReserve;
        address royaltyRecipient;
        uint16 royaltyBps;
        bytes32 salt;
    }

    INFTFeePolicy public immutable feePolicy;
    address public immutable dropController;
    uint256 public collectionCount;
    mapping(uint256 collectionId => address collection) public collections;
    mapping(address collection => bool registered) public override isBlueFunCollection;

    event NFTCollectionCreated(
        uint256 indexed collectionId,
        address indexed collection,
        address indexed creator,
        string name,
        string symbol,
        string contractURI,
        uint256 initialTokenId,
        string initialItemURI,
        uint256 initialMaxSupply,
        uint16 royaltyBps
    );
    event NFTCollectionLaunchFeePaid(uint256 indexed collectionId, address indexed creator, uint256 amount);

    constructor(INFTFeePolicy feePolicy_, address dropController_) {
        if (address(feePolicy_) == address(0) || dropController_ == address(0)) {
            revert InvalidConfig();
        }
        feePolicy = feePolicy_;
        dropController = dropController_;
    }

    function createCollection(CreateCollectionParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 collectionId, address collection)
    {
        if (feePolicy.newCollectionsPaused()) revert CollectionsPaused();
        _validate(params);
        uint256 requiredFee = feePolicy.collectionLaunchFee();
        if (msg.value != requiredFee) revert IncorrectLaunchFee(msg.value, requiredFee);

        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, params.salt));
        collection = address(
            new BlueEdition1155{salt: effectiveSalt}(
                msg.sender,
                dropController,
                params.name,
                params.symbol,
                params.contractURI,
                params.initialItemURI,
                params.initialMaxSupply,
                params.initialCreatorReserve,
                params.royaltyRecipient,
                params.royaltyBps
            )
        );
        collectionId = ++collectionCount;
        collections[collectionId] = collection;
        isBlueFunCollection[collection] = true;
        if (requiredFee != 0) {
            (bool ok,) = payable(feePolicy.platformWallet()).call{value: requiredFee}("");
            if (!ok) revert PlatformTransferFailed();
        }

        emit NFTCollectionLaunchFeePaid(collectionId, msg.sender, requiredFee);
        emit NFTCollectionCreated(
            collectionId,
            collection,
            msg.sender,
            params.name,
            params.symbol,
            params.contractURI,
            1,
            params.initialItemURI,
            params.initialMaxSupply,
            params.royaltyBps
        );
    }

    function predictCollectionAddress(address creator, CreateCollectionParams calldata params)
        external
        view
        returns (address predicted)
    {
        bytes32 effectiveSalt = keccak256(abi.encode(creator, block.chainid, params.salt));
        bytes memory initCode = abi.encodePacked(
            type(BlueEdition1155).creationCode,
            abi.encode(
                creator,
                dropController,
                params.name,
                params.symbol,
                params.contractURI,
                params.initialItemURI,
                params.initialMaxSupply,
                params.initialCreatorReserve,
                params.royaltyRecipient,
                params.royaltyBps
            )
        );
        predicted = address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), effectiveSalt, keccak256(initCode))))
            )
        );
    }

    function _validate(CreateCollectionParams calldata params) private pure {
        if (
            bytes(params.name).length == 0 || bytes(params.name).length > 64 || bytes(params.symbol).length == 0
                || bytes(params.symbol).length > 16 || bytes(params.contractURI).length == 0
                || bytes(params.contractURI).length > 512 || bytes(params.initialItemURI).length == 0
                || bytes(params.initialItemURI).length > 512 || params.initialMaxSupply == 0
                || params.initialCreatorReserve > params.initialMaxSupply
                || params.royaltyRecipient == address(0) || params.royaltyBps > 1_000
        ) revert InvalidConfig();
    }
}
