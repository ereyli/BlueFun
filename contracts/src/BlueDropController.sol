// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";
import {MerkleProofLib} from "./libraries/MerkleProofLib.sol";
import {IBlueEdition1155} from "./interfaces/IBlueEdition1155.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";
import {NativeSettlement} from "./libraries/NativeSettlement.sol";

/// @notice Public and Merkle-allowlist primary mint controller for BlueFun ERC-1155 collections.
/// @dev Phase schedules are append-only and non-overlapping. A replacement controller can be authorized by the creator.
contract BlueDropController is ReentrancyGuard {
    error NotCollectionOwner();
    error InvalidAddress();
    error InvalidPhase();
    error InvalidSchedule();
    error InvalidQuantity();
    error InvalidPayment();
    error UnsupportedCurrency();
    error PhaseNotActive();
    error PhaseCancelled();
    error WalletLimitExceeded();
    error PhaseSupplyExceeded();
    error InvalidProof();
    error DeadlineExpired();
    error MintsPaused();
    error FeeTermsChanged();
    error NotConfigurationAdmin();
    error FactoriesAlreadyConfigured();
    error NotCollectionFactory();
    error UnregisteredCollection();

    uint16 private constant BPS = 10_000;
    uint32 public constant MAX_PFP_MINT_PER_TRANSACTION = 100;

    enum PhaseType {
        PUBLIC,
        MERKLE_ALLOWLIST
    }

    enum LimitMode {
        PER_PHASE,
        CUMULATIVE
    }

    struct PhaseConfig {
        PhaseType phaseType;
        LimitMode limitMode;
        address currency;
        uint128 mintPrice;
        uint64 startTime;
        uint64 endTime;
        uint64 phaseSupplyCap;
        uint32 defaultWalletLimit;
        uint32 maxPerTransaction;
        bytes32 merkleRoot;
    }

    struct Phase {
        PhaseType phaseType;
        LimitMode limitMode;
        address currency;
        uint128 mintPrice;
        uint64 startTime;
        uint64 endTime;
        uint64 phaseSupplyCap;
        uint32 defaultWalletLimit;
        uint32 maxPerTransaction;
        bytes32 merkleRoot;
        uint64 previousPhaseEnd;
        bool cancelled;
    }

    INFTFeePolicy public immutable feePolicy;
    address public immutable weth;
    address public configurationAdmin;
    address public editionFactory;
    address public pfpFactory;
    mapping(address collection => bool registered) public registeredCollection;
    mapping(address collection => uint8 standard) public collectionStandard;

    mapping(address collection => mapping(uint256 tokenId => uint256 nextId)) public nextPhaseId;
    mapping(address collection => mapping(uint256 tokenId => uint256 id)) public latestPhaseId;
    mapping(address collection => mapping(uint256 tokenId => uint64 endTime)) public lastPhaseEnd;
    mapping(address collection => mapping(uint256 tokenId => mapping(uint256 phaseId => Phase phase))) public phases;
    mapping(address collection => mapping(uint256 tokenId => mapping(uint256 phaseId => uint256 amount))) public
        phaseMinted;
    mapping(address collection => mapping(uint256 tokenId => mapping(uint256 phaseId => uint16 bps))) public
        maximumPrimaryFeeBps;
    mapping(
        address collection
            => mapping(uint256 tokenId => mapping(uint256 phaseId => mapping(address wallet => uint256 amount)))
    ) public mintedByWalletInPhase;
    mapping(address collection => mapping(uint256 tokenId => mapping(address wallet => uint256 amount))) public
        mintedByWalletTotal;
    event PhaseCreated(
        address indexed collection, uint256 indexed tokenId, uint256 indexed phaseId, PhaseConfig config
    );
    event PhaseUpdated(
        address indexed collection, uint256 indexed tokenId, uint256 indexed phaseId, PhaseConfig config
    );
    event PhaseCancelledEvent(address indexed collection, uint256 indexed tokenId, uint256 indexed phaseId);
    event NFTMinted(
        address indexed collection,
        uint256 indexed tokenId,
        uint256 indexed phaseId,
        address payer,
        address recipient,
        uint256 quantity,
        uint256 unitPrice,
        uint256 grossAmount,
        uint256 platformFee
    );
    event AutomaticPayout(address indexed collection, address indexed recipient, uint256 amount, bool paidAsWETH);
    event CollectionFactoriesConfigured(address indexed editionFactory, address indexed pfpFactory);
    event CollectionRegistered(address indexed factory, address indexed collection);

    constructor(INFTFeePolicy feePolicy_, address weth_, address configurationAdmin_) {
        if (address(feePolicy_) == address(0) || configurationAdmin_ == address(0)) revert InvalidAddress();
        NativeSettlement.validate(weth_);
        feePolicy = feePolicy_;
        weth = weth_;
        configurationAdmin = configurationAdmin_;
    }

    /// @notice One-time deployment wiring. The temporary configurator is permanently cleared.
    function configureFactories(address editionFactory_, address pfpFactory_) external {
        if (msg.sender != configurationAdmin) revert NotConfigurationAdmin();
        if (editionFactory != address(0) || pfpFactory != address(0)) revert FactoriesAlreadyConfigured();
        if (editionFactory_.code.length == 0 || pfpFactory_.code.length == 0) revert InvalidAddress();
        editionFactory = editionFactory_;
        pfpFactory = pfpFactory_;
        configurationAdmin = address(0);
        emit CollectionFactoriesConfigured(editionFactory_, pfpFactory_);
    }

    function registerCollection(address collection) external {
        if (msg.sender != editionFactory && msg.sender != pfpFactory) revert NotCollectionFactory();
        if (collection.code.length == 0 || registeredCollection[collection]) revert InvalidAddress();
        registeredCollection[collection] = true;
        collectionStandard[collection] = msg.sender == pfpFactory ? 2 : 1;
        emit CollectionRegistered(msg.sender, collection);
    }

    function createPhase(address collection, uint256 tokenId, PhaseConfig calldata config)
        external
        returns (uint256 phaseId)
    {
        _onlyCollectionOwner(collection);
        uint64 previousEnd = lastPhaseEnd[collection][tokenId];
        _validatePhaseConfig(collection, tokenId, config, previousEnd);
        phaseId = nextPhaseId[collection][tokenId] + 1;
        nextPhaseId[collection][tokenId] = phaseId;
        latestPhaseId[collection][tokenId] = phaseId;
        lastPhaseEnd[collection][tokenId] = config.endTime;
        _storePhase(phases[collection][tokenId][phaseId], config, previousEnd);
        maximumPrimaryFeeBps[collection][tokenId][phaseId] = feePolicy.primaryMintFeeBps();
        emit PhaseCreated(collection, tokenId, phaseId, config);
    }

    /// @notice A scheduled phase may be edited before it starts without crossing either neighbour.
    function updatePhase(address collection, uint256 tokenId, uint256 phaseId, PhaseConfig calldata config) public {
        _onlyCollectionOwner(collection);
        uint256 latest = latestPhaseId[collection][tokenId];
        if (phaseId == 0 || phaseId > latest) revert InvalidPhase();
        Phase storage phase = phases[collection][tokenId][phaseId];
        if (phase.cancelled || block.timestamp >= phase.startTime) revert InvalidPhase();
        _validatePhaseConfig(collection, tokenId, config, phase.previousPhaseEnd);
        uint256 nextActive = _nextActivePhase(collection, tokenId, phaseId + 1, latest);
        if (nextActive != 0 && config.endTime > phases[collection][tokenId][nextActive].startTime) {
            revert InvalidSchedule();
        }
        _storePhase(phase, config, phase.previousPhaseEnd);
        maximumPrimaryFeeBps[collection][tokenId][phaseId] = feePolicy.primaryMintFeeBps();
        if (nextActive == 0) lastPhaseEnd[collection][tokenId] = config.endTime;
        else phases[collection][tokenId][nextActive].previousPhaseEnd = config.endTime;
        emit PhaseUpdated(collection, tokenId, phaseId, config);
    }

    /// @notice Backwards-compatible shortcut for clients that only manage the tail phase.
    function updateLatestPhase(address collection, uint256 tokenId, PhaseConfig calldata config) external {
        updatePhase(collection, tokenId, latestPhaseId[collection][tokenId], config);
    }

    /// @notice Cancels any phase, including an active allowlist that already has a public successor.
    function cancelPhase(address collection, uint256 tokenId, uint256 phaseId) public {
        _onlyCollectionOwner(collection);
        uint256 latest = latestPhaseId[collection][tokenId];
        if (phaseId == 0 || phaseId > latest) revert InvalidPhase();
        Phase storage phase = phases[collection][tokenId][phaseId];
        if (phase.cancelled) revert PhaseCancelled();
        phase.cancelled = true;
        uint256 nextActive = _nextActivePhase(collection, tokenId, phaseId + 1, latest);
        if (nextActive == 0) lastPhaseEnd[collection][tokenId] = phase.previousPhaseEnd;
        else phases[collection][tokenId][nextActive].previousPhaseEnd = phase.previousPhaseEnd;
        emit PhaseCancelledEvent(collection, tokenId, phaseId);
    }

    function cancelLatestPhase(address collection, uint256 tokenId) external {
        cancelPhase(collection, tokenId, latestPhaseId[collection][tokenId]);
    }

    function mintPublic(
        address collection,
        uint256 tokenId,
        uint256 phaseId,
        uint256 quantity,
        address recipient,
        uint256 expectedUnitPrice,
        uint256 deadline
    ) external payable nonReentrant {
        Phase storage phase = phases[collection][tokenId][phaseId];
        if (phase.phaseType != PhaseType.PUBLIC) revert InvalidPhase();
        _mint(
            collection,
            tokenId,
            phaseId,
            phase,
            quantity,
            recipient,
            phase.defaultWalletLimit,
            expectedUnitPrice,
            deadline
        );
    }

    function mintAllowlist(
        address collection,
        uint256 tokenId,
        uint256 phaseId,
        uint256 quantity,
        address recipient,
        uint256 walletAllowance,
        uint256 allowlistUnitPrice,
        uint256 deadline,
        bytes32[] calldata proof
    ) external payable nonReentrant {
        Phase storage phase = phases[collection][tokenId][phaseId];
        if (phase.phaseType != PhaseType.MERKLE_ALLOWLIST) revert InvalidPhase();
        bytes32 inner = keccak256(
            abi.encode(
                block.chainid,
                collection,
                tokenId,
                phaseId,
                msg.sender,
                walletAllowance,
                allowlistUnitPrice,
                phase.currency
            )
        );
        bytes32 leaf = keccak256(abi.encodePacked(inner));
        if (!MerkleProofLib.verify(proof, phase.merkleRoot, leaf)) revert InvalidProof();
        _mint(collection, tokenId, phaseId, phase, quantity, recipient, walletAllowance, allowlistUnitPrice, deadline);
    }

    function allowlistLeaf(
        address collection,
        uint256 tokenId,
        uint256 phaseId,
        address wallet,
        uint256 walletAllowance,
        uint256 unitPrice,
        address currency
    ) external view returns (bytes32) {
        bytes32 inner = keccak256(
            abi.encode(block.chainid, collection, tokenId, phaseId, wallet, walletAllowance, unitPrice, currency)
        );
        return keccak256(abi.encodePacked(inner));
    }

    function _mint(
        address collection,
        uint256 tokenId,
        uint256 phaseId,
        Phase storage phase,
        uint256 quantity,
        address recipient,
        uint256 walletLimit,
        uint256 unitPrice,
        uint256 deadline
    ) private {
        if (feePolicy.newMintsPaused()) revert MintsPaused();
        if (deadline < block.timestamp) revert DeadlineExpired();
        if (recipient == address(0) || quantity == 0 || quantity > phase.maxPerTransaction) revert InvalidQuantity();
        if (phase.cancelled) revert PhaseCancelled();
        if (block.timestamp < phase.startTime || block.timestamp >= phase.endTime) revert PhaseNotActive();
        if (phase.currency != address(0)) revert UnsupportedCurrency();
        if (phase.phaseType == PhaseType.PUBLIC && unitPrice != phase.mintPrice) revert InvalidPayment();

        uint256 mintedInPhase = mintedByWalletInPhase[collection][tokenId][phaseId][msg.sender];
        uint256 mintedTotal = mintedByWalletTotal[collection][tokenId][msg.sender];
        if (walletLimit != 0) {
            uint256 used = phase.limitMode == LimitMode.PER_PHASE ? mintedInPhase : mintedTotal;
            if (used + quantity > walletLimit) revert WalletLimitExceeded();
        }
        uint256 currentPhaseMinted = phaseMinted[collection][tokenId][phaseId];
        if (phase.phaseSupplyCap != 0 && currentPhaseMinted + quantity > phase.phaseSupplyCap) {
            revert PhaseSupplyExceeded();
        }

        uint256 gross = unitPrice * quantity;
        if (msg.value != gross) revert InvalidPayment();
        uint16 primaryFeeBps = feePolicy.primaryMintFeeBps();
        if (primaryFeeBps > maximumPrimaryFeeBps[collection][tokenId][phaseId]) revert FeeTermsChanged();
        uint256 platformFee = gross == 0 ? 0 : (gross * primaryFeeBps) / BPS;
        mintedByWalletInPhase[collection][tokenId][phaseId][msg.sender] = mintedInPhase + quantity;
        mintedByWalletTotal[collection][tokenId][msg.sender] = mintedTotal + quantity;
        phaseMinted[collection][tokenId][phaseId] = currentPhaseMinted + quantity;

        IBlueEdition1155(collection).mintByController(recipient, tokenId, quantity, "");
        address creatorRecipient = IBlueEdition1155(collection).payoutRecipient();
        if (creatorRecipient == address(0)) revert InvalidAddress();
        _payout(collection, creatorRecipient, gross - platformFee);
        if (platformFee != 0) _payout(collection, feePolicy.platformWallet(), platformFee);
        emit NFTMinted(collection, tokenId, phaseId, msg.sender, recipient, quantity, unitPrice, gross, platformFee);
    }

    function _validatePhaseConfig(address collection, uint256 tokenId, PhaseConfig calldata config, uint64 minimumStart)
        private
        view
    {
        if (collection == address(0) || IBlueEdition1155(collection).maxSupply(tokenId) == 0) revert InvalidAddress();
        if (config.currency != address(0)) revert UnsupportedCurrency();
        if (collectionStandard[collection] == 2 && config.maxPerTransaction > MAX_PFP_MINT_PER_TRANSACTION) {
            revert InvalidQuantity();
        }
        if (config.startTime < minimumStart || config.endTime <= config.startTime || config.maxPerTransaction == 0) {
            revert InvalidSchedule();
        }
        if (config.phaseType == PhaseType.PUBLIC && config.merkleRoot != bytes32(0)) revert InvalidPhase();
        if (config.phaseType == PhaseType.MERKLE_ALLOWLIST && config.merkleRoot == bytes32(0)) revert InvalidPhase();
        uint256 cap = IBlueEdition1155(collection).maxSupply(tokenId);
        if (config.phaseSupplyCap > cap) revert PhaseSupplyExceeded();
    }

    function _storePhase(Phase storage phase, PhaseConfig calldata config, uint64 previousEnd) private {
        phase.phaseType = config.phaseType;
        phase.limitMode = config.limitMode;
        phase.currency = config.currency;
        phase.mintPrice = config.mintPrice;
        phase.startTime = config.startTime;
        phase.endTime = config.endTime;
        phase.phaseSupplyCap = config.phaseSupplyCap;
        phase.defaultWalletLimit = config.defaultWalletLimit;
        phase.maxPerTransaction = config.maxPerTransaction;
        phase.merkleRoot = config.merkleRoot;
        phase.previousPhaseEnd = previousEnd;
        phase.cancelled = false;
    }

    function _nextActivePhase(address collection, uint256 tokenId, uint256 candidate, uint256 latest)
        private
        view
        returns (uint256)
    {
        while (candidate <= latest) {
            if (!phases[collection][tokenId][candidate].cancelled) return candidate;
            unchecked {
                ++candidate;
            }
        }
        return 0;
    }

    function _onlyCollectionOwner(address collection) private view {
        if (!registeredCollection[collection]) revert UnregisteredCollection();
        if (IBlueEdition1155(collection).owner() != msg.sender) revert NotCollectionOwner();
    }

    function _payout(address collection, address recipient, uint256 amount) private {
        if (amount == 0) return;
        bool paidAsWETH = NativeSettlement.pay(weth, recipient, amount);
        emit AutomaticPayout(collection, recipient, amount, paidAsWETH);
    }
}
