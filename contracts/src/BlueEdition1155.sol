// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

/// @notice Creator-owned ERC-1155 collection with immutable lifetime supply caps and modular mint controllers.
contract BlueEdition1155 is ReentrancyGuard {
    error NotOwner();
    error NotPendingOwner();
    error NotController();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidToken();
    error InvalidReceiver();
    error InsufficientBalance();
    error NotApproved();
    error SupplyExceeded();
    error SupplyIncreaseAfterMint();
    error MetadataFrozen();
    error RoyaltyFrozen();
    error RoyaltyIncreaseAfterMint();
    error InvalidRoyalty();
    error TransferRejected();
    error ReserveExceeded();
    error ControllerLockedAfterMint();
    error ValidatorLockedAfterMint();

    uint16 private constant BPS = 10_000;
    uint256 private constant TRANSFER_VALIDATOR_GAS_LIMIT = 100_000;
    uint16 public constant MAX_ROYALTY_BPS = 1_000;

    string public name;
    string public symbol;
    string public contractURI;
    address public immutable originalCreator;
    address public owner;
    address public pendingOwner;
    address public payoutRecipient;
    address public transferValidator;
    uint256 public nextTokenId = 1;
    uint256 public totalLifetimeMinted;
    bool public contractMetadataFrozen;
    bool public royaltyFrozen;
    address public royaltyRecipient;
    uint16 public royaltyBps;

    mapping(address controller => bool allowed) public mintController;
    mapping(uint256 tokenId => uint256 amount) public maxSupply;
    mapping(uint256 tokenId => uint256 amount) public lifetimeMinted;
    mapping(uint256 tokenId => uint256 amount) public burnedSupply;
    mapping(uint256 tokenId => uint256 amount) public creatorReserveRemaining;
    mapping(uint256 tokenId => string value) private _tokenURI;
    mapping(uint256 tokenId => bool frozen) public tokenMetadataFrozen;
    mapping(uint256 tokenId => mapping(address account => uint256 amount)) private _balanceOf;
    mapping(address account => mapping(address operator => bool approved)) private _operatorApproval;

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(
        address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PayoutRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event MintControllerUpdated(address indexed controller, bool allowed);
    event ItemCreated(uint256 indexed tokenId, uint256 maxSupply, string uri);
    event MaxSupplyUpdated(uint256 indexed tokenId, uint256 previousSupply, uint256 newSupply);
    event ContractURIUpdated();
    event ContractMetadataFrozen();
    event TokenMetadataFrozen(uint256 indexed tokenId);
    event RoyaltyUpdated(address indexed recipient, uint16 bps);
    event RoyaltyFrozenForever(address indexed recipient, uint16 bps);
    event TransferValidatorUpdated(address oldValidator, address newValidator);
    event CreatorReserveReleased(uint256 indexed tokenId, uint256 amount, uint256 remaining);
    event CreatorAirdrop(
        uint256 indexed tokenId, address indexed recipient, uint256 quantity, uint256 remainingReserve
    );

    constructor(
        address creator_,
        address initialController_,
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        string memory initialItemURI_,
        uint256 initialMaxSupply_,
        uint256 initialCreatorReserve_,
        address royaltyRecipient_,
        uint16 royaltyBps_
    ) {
        if (creator_ == address(0) || initialController_ == address(0) || royaltyRecipient_ == address(0)) {
            revert InvalidAddress();
        }
        if (initialMaxSupply_ == 0 || bytes(initialItemURI_).length == 0) revert InvalidAmount();
        if (initialCreatorReserve_ > initialMaxSupply_) revert ReserveExceeded();
        if (royaltyBps_ > MAX_ROYALTY_BPS) revert InvalidRoyalty();
        originalCreator = creator_;
        owner = creator_;
        payoutRecipient = creator_;
        name = name_;
        symbol = symbol_;
        contractURI = contractURI_;
        royaltyRecipient = royaltyRecipient_;
        royaltyBps = royaltyBps_;
        mintController[initialController_] = true;
        _createItem(initialItemURI_, initialMaxSupply_, initialCreatorReserve_);
        emit OwnershipTransferred(address(0), creator_);
        emit PayoutRecipientUpdated(address(0), creator_);
        emit MintControllerUpdated(initialController_, true);
        emit RoyaltyUpdated(royaltyRecipient_, royaltyBps_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0xd9b67a26 // ERC-1155
            || interfaceId == 0x0e89341c // ERC-1155 metadata URI
            || interfaceId == 0x2a55205a // ERC-2981
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

    function setPayoutRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidAddress();
        emit PayoutRecipientUpdated(payoutRecipient, newRecipient);
        payoutRecipient = newRecipient;
    }

    function setMintController(address controller, bool allowed) external onlyOwner {
        if (controller == address(0)) revert InvalidAddress();
        if (totalLifetimeMinted != 0 && mintController[controller] != allowed) revert ControllerLockedAfterMint();
        mintController[controller] = allowed;
        emit MintControllerUpdated(controller, allowed);
    }

    function createItem(string calldata tokenURI_, uint256 maxSupply_) external onlyOwner returns (uint256 tokenId) {
        if (maxSupply_ == 0 || bytes(tokenURI_).length == 0) revert InvalidAmount();
        tokenId = _createItem(tokenURI_, maxSupply_, 0);
    }

    function createItemWithReserve(string calldata tokenURI_, uint256 maxSupply_, uint256 reserve_)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        if (maxSupply_ == 0 || bytes(tokenURI_).length == 0) revert InvalidAmount();
        if (reserve_ > maxSupply_) revert ReserveExceeded();
        tokenId = _createItem(tokenURI_, maxSupply_, reserve_);
    }

    function setMaxSupply(uint256 tokenId, uint256 newMaxSupply) external onlyOwner {
        uint256 previous = maxSupply[tokenId];
        if (previous == 0) revert InvalidToken();
        uint256 minted = lifetimeMinted[tokenId];
        if (newMaxSupply < minted + creatorReserveRemaining[tokenId] || newMaxSupply == 0) revert SupplyExceeded();
        if (minted != 0 && newMaxSupply > previous) revert SupplyIncreaseAfterMint();
        maxSupply[tokenId] = newMaxSupply;
        emit MaxSupplyUpdated(tokenId, previous, newMaxSupply);
    }

    function setTokenURI(uint256 tokenId, string calldata newURI) external onlyOwner {
        if (maxSupply[tokenId] == 0) revert InvalidToken();
        if (tokenMetadataFrozen[tokenId]) revert MetadataFrozen();
        if (bytes(newURI).length == 0) revert InvalidAmount();
        _tokenURI[tokenId] = newURI;
        emit URI(newURI, tokenId);
    }

    function freezeTokenMetadata(uint256 tokenId) external onlyOwner {
        if (maxSupply[tokenId] == 0) revert InvalidToken();
        tokenMetadataFrozen[tokenId] = true;
        emit TokenMetadataFrozen(tokenId);
    }

    function setContractURI(string calldata newURI) external onlyOwner {
        if (contractMetadataFrozen) revert MetadataFrozen();
        if (bytes(newURI).length == 0) revert InvalidAmount();
        contractURI = newURI;
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
        receiver = royaltyRecipient;
        amount = (salePrice * royaltyBps) / BPS;
    }

    function setTransferValidator(address newValidator) external onlyOwner {
        if (newValidator != address(0) && newValidator != transferValidator && totalLifetimeMinted != 0) {
            revert ValidatorLockedAfterMint();
        }
        emit TransferValidatorUpdated(transferValidator, newValidator);
        transferValidator = newValidator;
    }

    function getTransferValidator() external view returns (address) {
        return transferValidator;
    }

    function getTransferValidationFunction() external pure returns (bytes4 functionSignature, bool isViewFunction) {
        return (bytes4(keccak256("validateTransfer(address,address,address,uint256,uint256)")), true);
    }

    function uri(uint256 tokenId) external view returns (string memory) {
        if (maxSupply[tokenId] == 0) revert InvalidToken();
        return _tokenURI[tokenId];
    }

    function totalSupply(uint256 tokenId) external view returns (uint256) {
        return lifetimeMinted[tokenId] - burnedSupply[tokenId];
    }

    function balanceOf(address account, uint256 tokenId) public view returns (uint256) {
        if (account == address(0)) revert InvalidAddress();
        return _balanceOf[tokenId][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory balances)
    {
        if (accounts.length != ids.length) revert InvalidAmount();
        balances = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            balances[i] = balanceOf(accounts[i], ids[i]);
        }
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert InvalidAddress();
        _operatorApproval[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return _operatorApproval[account][operator];
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        if (msg.sender != from && !_operatorApproval[from][msg.sender]) revert NotApproved();
        _transfer(msg.sender, from, to, id, amount);
        _checkSingleReceiver(msg.sender, from, to, id, amount, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        if (msg.sender != from && !_operatorApproval[from][msg.sender]) {
            revert NotApproved();
        }
        if (ids.length != amounts.length || ids.length == 0) revert InvalidAmount();
        if (to == address(0)) revert InvalidReceiver();
        for (uint256 i; i < ids.length; ++i) {
            _validateTransfer(msg.sender, from, to, ids[i], amounts[i]);
            uint256 balance = _balanceOf[ids[i]][from];
            if (balance < amounts[i]) revert InsufficientBalance();
            unchecked {
                _balanceOf[ids[i]][from] = balance - amounts[i];
                _balanceOf[ids[i]][to] += amounts[i];
            }
        }
        emit TransferBatch(msg.sender, from, to, ids, amounts);
        if (to.code.length != 0) {
            (bool ok, bytes memory result) =
                to.call(abi.encodeWithSelector(0xbc197c81, msg.sender, from, ids, amounts, data));
            if (!ok || result.length < 32 || abi.decode(result, (bytes4)) != 0xbc197c81) revert InvalidReceiver();
        }
    }

    function mintByController(address to, uint256 tokenId, uint256 quantity, bytes calldata data)
        external
        nonReentrant
    {
        if (!mintController[msg.sender]) revert NotController();
        if (to == address(0) || quantity == 0) revert InvalidAmount();
        uint256 cap = maxSupply[tokenId];
        if (cap == 0) revert InvalidToken();
        uint256 minted = lifetimeMinted[tokenId];
        if (minted + quantity > cap - creatorReserveRemaining[tokenId]) revert SupplyExceeded();
        _validateTransfer(msg.sender, address(0), to, tokenId, quantity);
        lifetimeMinted[tokenId] = minted + quantity;
        totalLifetimeMinted += quantity;
        _balanceOf[tokenId][to] += quantity;
        emit TransferSingle(msg.sender, address(0), to, tokenId, quantity);
        _checkSingleReceiver(msg.sender, address(0), to, tokenId, quantity, data);
    }

    function airdrop(uint256 tokenId, address[] calldata recipients, uint256[] calldata quantities)
        external
        onlyOwner
        nonReentrant
    {
        if (recipients.length == 0 || recipients.length != quantities.length) revert InvalidAmount();
        uint256 total = 0;
        for (uint256 i; i < quantities.length; ++i) {
            if (recipients[i] == address(0) || quantities[i] == 0) revert InvalidAmount();
            total += quantities[i];
        }
        uint256 remaining = creatorReserveRemaining[tokenId];
        if (total > remaining) revert ReserveExceeded();
        creatorReserveRemaining[tokenId] = remaining - total;
        for (uint256 i; i < recipients.length; ++i) {
            _mintReserved(tokenId, recipients[i], quantities[i]);
            emit CreatorAirdrop(tokenId, recipients[i], quantities[i], creatorReserveRemaining[tokenId]);
        }
    }

    function releaseCreatorReserve(uint256 tokenId, uint256 amount) external onlyOwner {
        uint256 remaining = creatorReserveRemaining[tokenId];
        if (amount == 0 || amount > remaining) revert ReserveExceeded();
        creatorReserveRemaining[tokenId] = remaining - amount;
        emit CreatorReserveReleased(tokenId, amount, remaining - amount);
    }

    function burn(address from, uint256 tokenId, uint256 quantity) external {
        if (msg.sender != from && !_operatorApproval[from][msg.sender]) revert NotApproved();
        uint256 balance = _balanceOf[tokenId][from];
        if (quantity == 0 || balance < quantity) revert InsufficientBalance();
        _validateTransfer(msg.sender, from, address(0), tokenId, quantity);
        unchecked {
            _balanceOf[tokenId][from] = balance - quantity;
            burnedSupply[tokenId] += quantity;
        }
        emit TransferSingle(msg.sender, from, address(0), tokenId, quantity);
    }

    function _createItem(string memory tokenURI_, uint256 maxSupply_, uint256 reserve_)
        private
        returns (uint256 tokenId)
    {
        tokenId = nextTokenId++;
        maxSupply[tokenId] = maxSupply_;
        creatorReserveRemaining[tokenId] = reserve_;
        _tokenURI[tokenId] = tokenURI_;
        emit ItemCreated(tokenId, maxSupply_, tokenURI_);
        emit URI(tokenURI_, tokenId);
    }

    function _mintReserved(uint256 tokenId, address to, uint256 quantity) private {
        uint256 cap = maxSupply[tokenId];
        if (cap == 0) revert InvalidToken();
        uint256 minted = lifetimeMinted[tokenId];
        if (minted + quantity > cap) revert SupplyExceeded();
        _validateTransfer(msg.sender, address(0), to, tokenId, quantity);
        lifetimeMinted[tokenId] = minted + quantity;
        totalLifetimeMinted += quantity;
        _balanceOf[tokenId][to] += quantity;
        emit TransferSingle(msg.sender, address(0), to, tokenId, quantity);
        _checkSingleReceiver(msg.sender, address(0), to, tokenId, quantity, "");
    }

    function _transfer(address operator, address from, address to, uint256 id, uint256 amount) private {
        if (to == address(0)) revert InvalidReceiver();
        _validateTransfer(operator, from, to, id, amount);
        uint256 balance = _balanceOf[id][from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            _balanceOf[id][from] = balance - amount;
            _balanceOf[id][to] += amount;
        }
        emit TransferSingle(operator, from, to, id, amount);
    }

    function _validateTransfer(address operator, address from, address to, uint256 id, uint256 amount) private view {
        address validator = transferValidator;
        if (validator == address(0)) return;
        // Validation is deliberately read-only. A creator-selected validator may reject
        // a transfer, but it must not mutate state or re-enter this collection. The
        // assembly call also discards return data, preventing a return-data bomb.
        bytes memory callData = abi.encodeWithSignature(
            "validateTransfer(address,address,address,uint256,uint256)", operator, from, to, id, amount
        );
        bool ok;
        uint256 gasLimit = TRANSFER_VALIDATOR_GAS_LIMIT;
        assembly ("memory-safe") {
            ok := staticcall(gasLimit, validator, add(callData, 0x20), mload(callData), 0, 0)
        }
        if (!ok) revert TransferRejected();
    }

    function _checkSingleReceiver(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) private {
        if (to.code.length == 0) return;
        (bool ok, bytes memory result) = to.call(abi.encodeWithSelector(0xf23a6e61, operator, from, id, amount, data));
        if (!ok || result.length < 32 || abi.decode(result, (bytes4)) != 0xf23a6e61) revert InvalidReceiver();
    }
}
