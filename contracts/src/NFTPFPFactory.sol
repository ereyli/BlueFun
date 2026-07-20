// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {BluePFP721} from "./BluePFP721.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";
import {INFTCollectionRegistry} from "./interfaces/INFTCollectionRegistry.sol";
import {NativeSettlement} from "./libraries/NativeSettlement.sol";

interface IBlueDropPFPRegistry {
    function registerCollection(address collection) external;
}

/// @notice Permissionless creator-owned ERC-721 PFP drop factory.
contract NFTPFPFactory is ReentrancyGuard, INFTCollectionRegistry {
    error InvalidConfig();
    error IncorrectLaunchFee(uint256 supplied, uint256 required);
    error CollectionsPaused();

    struct CreatePFPParams {
        string name;
        string symbol;
        string contractURI;
        string baseURI;
        string placeholderURI;
        uint256 maxSupply;
        bytes32 provenanceHash;
        bool revealed;
        uint256 creatorReserve;
        uint64 revealTime;
        bool freezeOnReveal;
        address royaltyRecipient;
        uint16 royaltyBps;
        bytes32 salt;
    }

    INFTFeePolicy public immutable feePolicy;
    address public immutable dropController;
    address public immutable weth;
    uint256 public collectionCount;
    mapping(uint256 collectionId => address collection) public collections;
    mapping(address collection => bool registered) public override isBlueFunCollection;

    event PFPCollectionCreated(
        uint256 indexed collectionId,
        address indexed collection,
        address indexed creator,
        string name,
        string symbol,
        string contractURI,
        uint256 maxSupply,
        bytes32 provenanceHash,
        bool revealed,
        uint16 royaltyBps
    );
    event PFPCollectionLaunchFeePaid(uint256 indexed collectionId, address indexed creator, uint256 amount);
    event LaunchFeePayout(address indexed recipient, uint256 amount, bool paidAsWETH);

    constructor(INFTFeePolicy feePolicy_, address dropController_, address weth_) {
        if (address(feePolicy_) == address(0) || dropController_ == address(0)) revert InvalidConfig();
        NativeSettlement.validate(weth_);
        feePolicy = feePolicy_;
        dropController = dropController_;
        weth = weth_;
    }

    function createPFPCollection(CreatePFPParams calldata params)
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
            new BluePFP721{salt: effectiveSalt}(
                msg.sender,
                dropController,
                params.name,
                params.symbol,
                params.contractURI,
                params.baseURI,
                params.placeholderURI,
                params.maxSupply,
                params.provenanceHash,
                params.revealed,
                params.creatorReserve,
                params.revealTime,
                params.revealTime == 0 ? bytes32(0) : _parseBytes32(params.baseURI),
                params.freezeOnReveal,
                params.royaltyRecipient,
                params.royaltyBps
            )
        );
        collectionId = ++collectionCount;
        collections[collectionId] = collection;
        isBlueFunCollection[collection] = true;
        IBlueDropPFPRegistry(dropController).registerCollection(collection);
        if (requiredFee != 0) {
            address recipient = feePolicy.platformWallet();
            bool paidAsWETH = NativeSettlement.pay(weth, recipient, requiredFee);
            emit LaunchFeePayout(recipient, requiredFee, paidAsWETH);
        }
        emit PFPCollectionLaunchFeePaid(collectionId, msg.sender, requiredFee);
        emit PFPCollectionCreated(
            collectionId,
            collection,
            msg.sender,
            params.name,
            params.symbol,
            params.contractURI,
            params.maxSupply,
            params.provenanceHash,
            params.revealed,
            params.royaltyBps
        );
    }

    function _validate(CreatePFPParams calldata params) private pure {
        if (
            bytes(params.name).length == 0 || bytes(params.name).length > 64 || bytes(params.symbol).length == 0
                || bytes(params.symbol).length > 16 || bytes(params.contractURI).length == 0
                || bytes(params.contractURI).length > 512 || bytes(params.placeholderURI).length == 0
                || bytes(params.placeholderURI).length > 512 || bytes(params.baseURI).length > 512
                || (params.revealed && bytes(params.baseURI).length == 0) || params.maxSupply == 0
                || params.maxSupply > type(uint64).max || params.creatorReserve > params.maxSupply
                || (params.revealed && params.revealTime != 0)
                || (!params.revealed && params.revealTime == 0 && bytes(params.baseURI).length != 0)
                || (params.revealTime != 0 && !_isBytes32(params.baseURI)) || params.royaltyRecipient == address(0)
                || params.royaltyBps > 1_000
        ) revert InvalidConfig();
    }

    function _isBytes32(string calldata value) private pure returns (bool) {
        bytes calldata data = bytes(value);
        if (data.length != 66 || data[0] != "0" || data[1] != "x") return false;
        for (uint256 i = 2; i < 66; ++i) {
            bytes1 char = data[i];
            if (!(char >= "0" && char <= "9") && !(char >= "a" && char <= "f") && !(char >= "A" && char <= "F")) {
                return false;
            }
        }
        return true;
    }

    function _parseBytes32(string calldata value) private pure returns (bytes32 result) {
        if (!_isBytes32(value)) revert InvalidConfig();
        bytes calldata data = bytes(value);
        uint256 parsed = 0;
        for (uint256 i = 2; i < 66; ++i) {
            uint8 char = uint8(data[i]);
            uint8 nibble = char >= 97 ? char - 87 : char >= 65 ? char - 55 : char - 48;
            parsed = (parsed << 4) | nibble;
        }
        result = bytes32(parsed);
    }
}
