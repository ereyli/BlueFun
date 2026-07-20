// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

/// @notice Creator-owned ERC-721 PFP collection with sequential controller mints and delayed reveal.
contract BluePFP721 is ReentrancyGuard {
    error NotOwner();
    error NotPendingOwner();
    error NotController();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidToken();
    error NotApproved();
    error MetadataFrozen();
    error AlreadyRevealed();
    error SupplyExceeded();
    error RoyaltyFrozen();
    error RoyaltyIncreaseAfterMint();
    error InvalidRoyalty();
    error TransferRejected();
    error ReserveExceeded();
    error RevealNotScheduled();
    error RevealTooEarly();
    error InvalidRevealProof();
    error RevealScheduleLocked();
    error ScheduledRevealRequired();
    error ControllerLockedAfterMint();
    error ValidatorLockedAfterMint();

    uint16 private constant BPS = 10_000;
    uint16 public constant MAX_ROYALTY_BPS = 1_000;
    uint256 public constant MAX_BATCH_MINT = 100;
    uint256 private constant TRANSFER_VALIDATOR_GAS_LIMIT = 100_000;

    string public name;
    string public symbol;
    string public contractURI;
    string public baseURI;
    string public placeholderURI;
    address public immutable originalCreator;
    address public owner;
    address public pendingOwner;
    address public payoutRecipient;
    address public transferValidator;
    address public royaltyRecipient;
    uint16 public royaltyBps;
    uint256 public immutable collectionMaxSupply;
    uint256 public totalLifetimeMinted;
    bytes32 public provenanceHash;
    bool public revealed;
    bool public metadataFrozen;
    bool public contractMetadataFrozen;
    bool public royaltyFrozen;
    uint256 public creatorReserveRemaining;
    bytes32 public scheduledRevealCommitment;
    uint64 public scheduledRevealTime;
    bool public scheduledRevealFreeze;

    mapping(address controller => bool allowed) public mintController;
    mapping(uint256 tokenId => address holder) private _ownerOf;
    mapping(address holder => uint256 amount) private _balanceOf;
    mapping(uint256 tokenId => address operator) private _tokenApproval;
    mapping(address holder => mapping(address operator => bool approved)) private _operatorApproval;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PayoutRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event MintControllerUpdated(address indexed controller, bool allowed);
    event ContractURIUpdated();
    event ContractMetadataFrozen();
    event PlaceholderURIUpdated();
    event BaseURIUpdated();
    event CollectionRevealed(string baseURI, bool metadataFrozen);
    event MetadataFrozenForever();
    event ProvenanceHashUpdated(bytes32 provenanceHash);
    event RoyaltyUpdated(address indexed recipient, uint16 bps);
    event RoyaltyFrozenForever(address indexed recipient, uint16 bps);
    event TransferValidatorUpdated(address oldValidator, address newValidator);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event CreatorReserveReleased(uint256 amount, uint256 remaining);
    event CreatorAirdrop(address indexed recipient, uint256 quantity, uint256 remainingReserve);
    event RevealScheduled(uint64 indexed revealTime, bytes32 indexed commitment, bool freezeAfterReveal);
    event ScheduledRevealCancelled();

    constructor(
        address creator_,
        address initialController_,
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        string memory baseURI_,
        string memory placeholderURI_,
        uint256 maxSupply_,
        bytes32 provenanceHash_,
        bool revealed_,
        uint256 creatorReserve_,
        uint64 revealTime_,
        bytes32 revealCommitment_,
        bool freezeOnReveal_,
        address royaltyRecipient_,
        uint16 royaltyBps_
    ) {
        if (creator_ == address(0) || initialController_ == address(0) || royaltyRecipient_ == address(0)) {
            revert InvalidAddress();
        }
        if (maxSupply_ == 0 || bytes(contractURI_).length == 0 || bytes(placeholderURI_).length == 0) {
            revert InvalidAmount();
        }
        if (revealed_ && bytes(baseURI_).length == 0) revert InvalidAmount();
        if (creatorReserve_ > maxSupply_) revert ReserveExceeded();
        if (revealed_ && revealTime_ != 0) revert InvalidAmount();
        if (revealTime_ != 0 && (revealTime_ <= block.timestamp || revealCommitment_ == bytes32(0))) {
            revert InvalidAmount();
        }
        if (revealTime_ == 0 && revealCommitment_ != bytes32(0)) revert InvalidAmount();
        if (royaltyBps_ > MAX_ROYALTY_BPS) revert InvalidRoyalty();
        originalCreator = creator_;
        owner = creator_;
        payoutRecipient = creator_;
        name = name_;
        symbol = symbol_;
        contractURI = contractURI_;
        baseURI = revealed_ ? baseURI_ : "";
        placeholderURI = placeholderURI_;
        collectionMaxSupply = maxSupply_;
        provenanceHash = provenanceHash_;
        revealed = revealed_;
        creatorReserveRemaining = creatorReserve_;
        royaltyRecipient = royaltyRecipient_;
        royaltyBps = royaltyBps_;
        mintController[initialController_] = true;
        emit OwnershipTransferred(address(0), creator_);
        emit PayoutRecipientUpdated(address(0), creator_);
        emit MintControllerUpdated(initialController_, true);
        emit RoyaltyUpdated(royaltyRecipient_, royaltyBps_);
        if (provenanceHash_ != bytes32(0)) emit ProvenanceHashUpdated(provenanceHash_);
        if (revealTime_ != 0) {
            bytes32 domainCommitment = _domainRevealCommitment(revealCommitment_);
            scheduledRevealCommitment = domainCommitment;
            scheduledRevealTime = revealTime_;
            scheduledRevealFreeze = freezeOnReveal_;
            emit RevealScheduled(revealTime_, domainCommitment, freezeOnReveal_);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 metadata
            || interfaceId == 0x2a55205a // ERC-2981
            || interfaceId == 0x49064906 // ERC-4906 metadata events
            || interfaceId == 0x7f5828d0; // ERC-173
    }

    function proposeOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0) || newOwner == owner) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwner() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    function setPayoutRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert InvalidAddress();
        emit PayoutRecipientUpdated(payoutRecipient, recipient);
        payoutRecipient = recipient;
    }

    function setMintController(address controller, bool allowed) external onlyOwner {
        if (controller == address(0)) revert InvalidAddress();
        if (totalLifetimeMinted != 0 && mintController[controller] != allowed) revert ControllerLockedAfterMint();
        mintController[controller] = allowed;
        emit MintControllerUpdated(controller, allowed);
    }

    /// @dev Drop controller compatibility: a PFP collection is represented by tokenId=1.
    function maxSupply(uint256 tokenId) external view returns (uint256) {
        if (tokenId != 1) return 0;
        return collectionMaxSupply;
    }

    function lifetimeMinted(uint256 tokenId) external view returns (uint256) {
        if (tokenId != 1) return 0;
        return totalLifetimeMinted;
    }

    function mintByController(address to, uint256 tokenId, uint256 quantity, bytes calldata data)
        external
        nonReentrant
    {
        if (!mintController[msg.sender]) revert NotController();
        if (tokenId != 1 || to == address(0) || quantity == 0 || quantity > MAX_BATCH_MINT) revert InvalidAmount();
        uint256 first = totalLifetimeMinted + 1;
        uint256 last = totalLifetimeMinted + quantity;
        if (last > collectionMaxSupply - creatorReserveRemaining) revert SupplyExceeded();
        totalLifetimeMinted = last;
        for (uint256 id = first; id <= last; ++id) {
            _ownerOf[id] = to;
            unchecked {
                ++_balanceOf[to];
            }
            emit Transfer(address(0), to, id);
            _checkReceiver(msg.sender, address(0), to, id, data);
        }
    }

    function airdrop(address[] calldata recipients, uint256[] calldata quantities) external onlyOwner nonReentrant {
        if (recipients.length == 0 || recipients.length != quantities.length) revert InvalidAmount();
        uint256 total = 0;
        for (uint256 i; i < quantities.length; ++i) {
            if (recipients[i] == address(0) || quantities[i] == 0) revert InvalidAmount();
            total += quantities[i];
        }
        if (total > MAX_BATCH_MINT) revert InvalidAmount();
        if (total > creatorReserveRemaining) revert ReserveExceeded();
        creatorReserveRemaining -= total;
        for (uint256 i; i < recipients.length; ++i) {
            _mintReserved(recipients[i], quantities[i]);
            emit CreatorAirdrop(recipients[i], quantities[i], creatorReserveRemaining);
        }
    }

    function releaseCreatorReserve(uint256 amount) external onlyOwner {
        if (amount == 0 || amount > creatorReserveRemaining) revert ReserveExceeded();
        creatorReserveRemaining -= amount;
        emit CreatorReserveReleased(amount, creatorReserveRemaining);
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert InvalidAddress();
        return _balanceOf[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _ownerOf[tokenId];
        if (holder == address(0)) revert InvalidToken();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        if (!revealed) return placeholderURI;
        return string.concat(baseURI, _toString(tokenId));
    }

    function approve(address operator, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && !_operatorApproval[holder][msg.sender]) revert NotApproved();
        _tokenApproval[tokenId] = operator;
        emit Approval(holder, operator, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApproval[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert InvalidAddress();
        _operatorApproval[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address holder, address operator) external view returns (bool) {
        return _operatorApproval[holder][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0) || ownerOf(tokenId) != from) revert InvalidAddress();
        if (msg.sender != from && _tokenApproval[tokenId] != msg.sender && !_operatorApproval[from][msg.sender]) {
            revert NotApproved();
        }
        _validateTransfer(msg.sender, from, to, tokenId);
        delete _tokenApproval[tokenId];
        unchecked {
            --_balanceOf[from];
            ++_balanceOf[to];
        }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        _checkReceiver(msg.sender, from, to, tokenId, data);
    }

    function burn(uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && _tokenApproval[tokenId] != msg.sender && !_operatorApproval[holder][msg.sender]) {
            revert NotApproved();
        }
        _validateTransfer(msg.sender, holder, address(0), tokenId);
        delete _tokenApproval[tokenId];
        delete _ownerOf[tokenId];
        unchecked {
            --_balanceOf[holder];
        }
        emit Transfer(holder, address(0), tokenId);
    }

    function setPlaceholderURI(string calldata uri) external onlyOwner {
        if (metadataFrozen || revealed || bytes(uri).length == 0) revert MetadataFrozen();
        placeholderURI = uri;
        emit PlaceholderURIUpdated();
        if (totalLifetimeMinted != 0) emit BatchMetadataUpdate(1, totalLifetimeMinted);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        if (metadataFrozen || !revealed || bytes(uri).length == 0) revert MetadataFrozen();
        baseURI = uri;
        emit BaseURIUpdated();
        if (totalLifetimeMinted != 0) emit BatchMetadataUpdate(1, totalLifetimeMinted);
    }

    function reveal(string calldata uri, bool freezeAfterReveal) external onlyOwner {
        if (revealed) revert AlreadyRevealed();
        if (scheduledRevealTime != 0) revert ScheduledRevealRequired();
        if (metadataFrozen || bytes(uri).length == 0) revert MetadataFrozen();
        _reveal(uri, freezeAfterReveal);
    }

    function scheduleReveal(bytes32 commitment, uint64 revealTime, bool freezeAfterReveal) external onlyOwner {
        if (revealed) revert AlreadyRevealed();
        if (totalLifetimeMinted != 0) revert RevealScheduleLocked();
        if (metadataFrozen || commitment == bytes32(0)) revert MetadataFrozen();
        if (revealTime <= block.timestamp) revert RevealTooEarly();
        bytes32 domainCommitment = _domainRevealCommitment(commitment);
        scheduledRevealCommitment = domainCommitment;
        scheduledRevealTime = revealTime;
        scheduledRevealFreeze = freezeAfterReveal;
        emit RevealScheduled(revealTime, domainCommitment, freezeAfterReveal);
    }

    function cancelScheduledReveal() external onlyOwner {
        if (scheduledRevealTime == 0) revert RevealNotScheduled();
        if (totalLifetimeMinted != 0) revert RevealScheduleLocked();
        scheduledRevealCommitment = bytes32(0);
        scheduledRevealTime = 0;
        scheduledRevealFreeze = false;
        emit ScheduledRevealCancelled();
    }

    function executeScheduledReveal(string calldata uri, bytes32 secretSalt) external {
        uint64 revealTime = scheduledRevealTime;
        if (revealTime == 0) revert RevealNotScheduled();
        if (block.timestamp < revealTime) revert RevealTooEarly();
        bytes32 innerCommitment = keccak256(abi.encode(uri, secretSalt));
        if (_domainRevealCommitment(innerCommitment) != scheduledRevealCommitment) revert InvalidRevealProof();
        bool freezeAfterReveal = scheduledRevealFreeze;
        _reveal(uri, freezeAfterReveal);
    }

    function freezeMetadata() external onlyOwner {
        metadataFrozen = true;
        emit MetadataFrozenForever();
    }

    /// @notice Domain-separates a reveal commitment so it cannot be replayed across collections or chains.
    function revealCommitmentFor(bytes32 innerCommitment) external view returns (bytes32) {
        return _domainRevealCommitment(innerCommitment);
    }

    function setProvenanceHash(bytes32 value) external onlyOwner {
        if (metadataFrozen || totalLifetimeMinted != 0) revert MetadataFrozen();
        provenanceHash = value;
        emit ProvenanceHashUpdated(value);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        if (contractMetadataFrozen) revert MetadataFrozen();
        if (bytes(uri).length == 0) revert InvalidAmount();
        contractURI = uri;
        emit ContractURIUpdated();
    }

    function freezeContractMetadata() external onlyOwner {
        contractMetadataFrozen = true;
        emit ContractMetadataFrozen();
    }

    function setRoyalty(address recipient, uint16 bps) external onlyOwner {
        if (royaltyFrozen) revert RoyaltyFrozen();
        if (recipient == address(0) || bps > MAX_ROYALTY_BPS) revert InvalidRoyalty();
        if (totalLifetimeMinted != 0 && bps > royaltyBps) revert RoyaltyIncreaseAfterMint();
        royaltyRecipient = recipient;
        royaltyBps = bps;
        emit RoyaltyUpdated(recipient, bps);
    }

    function freezeRoyalty() external onlyOwner {
        royaltyFrozen = true;
        emit RoyaltyFrozenForever(royaltyRecipient, royaltyBps);
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 amount) {
        return (royaltyRecipient, (salePrice * royaltyBps) / BPS);
    }

    function setTransferValidator(address validator) external onlyOwner {
        if (validator != address(0) && validator != transferValidator && totalLifetimeMinted != 0) {
            revert ValidatorLockedAfterMint();
        }
        emit TransferValidatorUpdated(transferValidator, validator);
        transferValidator = validator;
    }

    function getTransferValidator() external view returns (address) {
        return transferValidator;
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (bytes4(keccak256("validateTransfer(address,address,address,uint256,uint256)")), true);
    }

    function _validateTransfer(address operator, address from, address to, uint256 tokenId) private view {
        address validator = transferValidator;
        if (validator == address(0)) return;
        (bool ok,) = validator.staticcall{gas: TRANSFER_VALIDATOR_GAS_LIMIT}(
            abi.encodeWithSignature(
                "validateTransfer(address,address,address,uint256,uint256)", operator, from, to, tokenId, 1
            )
        );
        if (!ok) revert TransferRejected();
    }

    function _mintReserved(address to, uint256 quantity) private {
        uint256 first = totalLifetimeMinted + 1;
        uint256 last = totalLifetimeMinted + quantity;
        if (last > collectionMaxSupply) revert SupplyExceeded();
        totalLifetimeMinted = last;
        for (uint256 id = first; id <= last; ++id) {
            _ownerOf[id] = to;
            unchecked {
                ++_balanceOf[to];
            }
            emit Transfer(address(0), to, id);
            _checkReceiver(msg.sender, address(0), to, id, "");
        }
    }

    function _reveal(string memory uri, bool freezeAfterReveal) private {
        if (revealed) revert AlreadyRevealed();
        if (metadataFrozen || bytes(uri).length == 0) revert MetadataFrozen();
        baseURI = uri;
        revealed = true;
        scheduledRevealCommitment = bytes32(0);
        scheduledRevealTime = 0;
        scheduledRevealFreeze = false;
        if (freezeAfterReveal) metadataFrozen = true;
        emit CollectionRevealed(uri, freezeAfterReveal);
        if (freezeAfterReveal) emit MetadataFrozenForever();
        if (totalLifetimeMinted != 0) emit BatchMetadataUpdate(1, totalLifetimeMinted);
    }

    function _checkReceiver(address operator, address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        (bool ok, bytes memory result) = to.call(abi.encodeWithSelector(0x150b7a02, operator, from, tokenId, data));
        if (!ok || result.length < 32 || abi.decode(result, (bytes4)) != 0x150b7a02) revert TransferRejected();
    }

    function _domainRevealCommitment(bytes32 innerCommitment) private view returns (bytes32) {
        return keccak256(abi.encode(innerCommitment, address(this), block.chainid));
    }

    function _toString(uint256 value) private pure returns (string memory str) {
        if (value == 0) return "0";
        uint256 digits = 0;
        uint256 current = value;
        while (current != 0) ++digits;
        current /= 10;
        bytes memory buffer = new bytes(digits);
        while (value != 0) buffer[--digits] = bytes1(uint8(48 + value % 10));
        value /= 10;
        str = string(buffer);
    }
}
