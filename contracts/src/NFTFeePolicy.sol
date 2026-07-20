// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";

/// @notice Bounded policy for BlueFun NFT collection creation, primary mint and marketplace fees.
/// @dev Fee increases are delayed; production deployments should separate multisig admin and guardian roles.
contract NFTFeePolicy is TwoStepAdmin, INFTFeePolicy {
    error InvalidAddress();
    error InvalidFee();
    error NotGuardian();
    error FeeIncreaseRequiresSchedule();
    error NoPendingFeeUpdate();
    error FeeUpdateNotReady();
    error NotPendingPlatformWallet();

    uint16 public constant BPS = 10_000;
    uint256 public constant MAX_COLLECTION_LAUNCH_FEE = 0.01 ether;
    uint16 public constant MAX_PRIMARY_MINT_FEE_BPS = 500; // 5% permanent admin ceiling.
    uint16 public constant MAX_MARKETPLACE_FEE_BPS = 100; // 1%
    uint64 public constant FEE_INCREASE_DELAY = 2 days;

    address public guardian;
    address payable public platformWallet;
    address payable public pendingPlatformWallet;
    uint256 public collectionLaunchFee = 0.001 ether;
    uint16 public primaryMintFeeBps = 200; // 2%.
    uint16 public marketplaceFeeBps = 80; // 0.8%, twenty percent below OpenSea's current 1%.
    bool public newCollectionsPaused;
    bool public newMintsPaused;
    bool public marketplacePaused;
    uint256 public pendingCollectionLaunchFee;
    uint16 public pendingPrimaryMintFeeBps;
    uint16 public pendingMarketplaceFeeBps;
    uint64 public pendingFeeUpdateTime;

    event CollectionLaunchFeeUpdated(uint256 previousFee, uint256 newFee);
    event PlatformFeesUpdated(
        uint16 previousPrimaryFeeBps,
        uint16 newPrimaryFeeBps,
        uint16 previousMarketplaceFeeBps,
        uint16 newMarketplaceFeeBps
    );
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event PlatformWalletUpdated(address indexed previousWallet, address indexed newWallet);
    event PlatformWalletTransferStarted(address indexed currentWallet, address indexed pendingWallet);
    event NewCollectionPauseUpdated(bool paused, address indexed caller);
    event NewMintPauseUpdated(bool paused, address indexed caller);
    event MarketplacePauseUpdated(bool paused, address indexed caller);
    event FeeIncreaseScheduled(
        uint256 collectionLaunchFee,
        uint16 primaryMintFeeBps,
        uint16 marketplaceFeeBps,
        uint64 executeAfter
    );
    event FeeIncreaseCancelled();

    constructor(address admin_, address guardian_, address payable platformWallet_) TwoStepAdmin(admin_) {
        if (guardian_ == address(0) || platformWallet_ == address(0)) revert InvalidAddress();
        guardian = guardian_;
        platformWallet = platformWallet_;
    }

    function setCollectionLaunchFee(uint256 newFee) external onlyAdmin {
        if (newFee > MAX_COLLECTION_LAUNCH_FEE) revert InvalidFee();
        if (newFee > collectionLaunchFee) revert FeeIncreaseRequiresSchedule();
        uint256 previous = collectionLaunchFee;
        collectionLaunchFee = newFee;
        emit CollectionLaunchFeeUpdated(previous, newFee);
    }

    function setPlatformFees(uint16 newPrimaryFeeBps, uint16 newMarketplaceFeeBps) external onlyAdmin {
        if (newPrimaryFeeBps > MAX_PRIMARY_MINT_FEE_BPS || newMarketplaceFeeBps > MAX_MARKETPLACE_FEE_BPS) {
            revert InvalidFee();
        }
        if (newPrimaryFeeBps > primaryMintFeeBps || newMarketplaceFeeBps > marketplaceFeeBps) {
            revert FeeIncreaseRequiresSchedule();
        }
        uint16 previousPrimary = primaryMintFeeBps;
        uint16 previousMarketplace = marketplaceFeeBps;
        primaryMintFeeBps = newPrimaryFeeBps;
        marketplaceFeeBps = newMarketplaceFeeBps;
        emit PlatformFeesUpdated(previousPrimary, newPrimaryFeeBps, previousMarketplace, newMarketplaceFeeBps);
    }

    function scheduleFeeIncrease(
        uint256 newCollectionLaunchFee,
        uint16 newPrimaryMintFeeBps,
        uint16 newMarketplaceFeeBps
    ) external onlyAdmin {
        _validateFees(newCollectionLaunchFee, newPrimaryMintFeeBps, newMarketplaceFeeBps);
        if (
            newCollectionLaunchFee <= collectionLaunchFee && newPrimaryMintFeeBps <= primaryMintFeeBps
                && newMarketplaceFeeBps <= marketplaceFeeBps
        ) revert InvalidFee();
        uint64 executeAfter = uint64(block.timestamp + FEE_INCREASE_DELAY);
        pendingCollectionLaunchFee = newCollectionLaunchFee;
        pendingPrimaryMintFeeBps = newPrimaryMintFeeBps;
        pendingMarketplaceFeeBps = newMarketplaceFeeBps;
        pendingFeeUpdateTime = executeAfter;
        emit FeeIncreaseScheduled(
            newCollectionLaunchFee, newPrimaryMintFeeBps, newMarketplaceFeeBps, executeAfter
        );
    }

    function executeFeeIncrease() external {
        uint64 executeAfter = pendingFeeUpdateTime;
        if (executeAfter == 0) revert NoPendingFeeUpdate();
        if (block.timestamp < executeAfter) revert FeeUpdateNotReady();

        uint256 newCollectionLaunchFee = pendingCollectionLaunchFee;
        uint16 newPrimaryMintFeeBps = pendingPrimaryMintFeeBps;
        uint16 newMarketplaceFeeBps = pendingMarketplaceFeeBps;
        _clearPendingFeeUpdate();

        uint256 previousLaunchFee = collectionLaunchFee;
        uint16 previousPrimary = primaryMintFeeBps;
        uint16 previousMarketplace = marketplaceFeeBps;
        collectionLaunchFee = newCollectionLaunchFee;
        primaryMintFeeBps = newPrimaryMintFeeBps;
        marketplaceFeeBps = newMarketplaceFeeBps;
        emit CollectionLaunchFeeUpdated(previousLaunchFee, newCollectionLaunchFee);
        emit PlatformFeesUpdated(previousPrimary, newPrimaryMintFeeBps, previousMarketplace, newMarketplaceFeeBps);
    }

    function cancelFeeIncrease() external onlyAdmin {
        if (pendingFeeUpdateTime == 0) revert NoPendingFeeUpdate();
        _clearPendingFeeUpdate();
        emit FeeIncreaseCancelled();
    }

    function setGuardian(address newGuardian) external onlyAdmin {
        if (newGuardian == address(0)) revert InvalidAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function proposePlatformWallet(address payable newWallet) external onlyAdmin {
        if (newWallet == address(0) || newWallet == platformWallet) revert InvalidAddress();
        pendingPlatformWallet = newWallet;
        emit PlatformWalletTransferStarted(platformWallet, newWallet);
    }

    function acceptPlatformWallet() external {
        if (msg.sender != pendingPlatformWallet) revert NotPendingPlatformWallet();
        address previous = platformWallet;
        platformWallet = payable(msg.sender);
        pendingPlatformWallet = payable(address(0));
        emit PlatformWalletUpdated(previous, msg.sender);
    }

    function pauseNewCollections() external {
        _onlyGuardianOrAdmin();
        newCollectionsPaused = true;
        emit NewCollectionPauseUpdated(true, msg.sender);
    }

    function unpauseNewCollections() external onlyAdmin {
        newCollectionsPaused = false;
        emit NewCollectionPauseUpdated(false, msg.sender);
    }

    function pauseNewMints() external {
        _onlyGuardianOrAdmin();
        newMintsPaused = true;
        emit NewMintPauseUpdated(true, msg.sender);
    }

    function unpauseNewMints() external onlyAdmin {
        newMintsPaused = false;
        emit NewMintPauseUpdated(false, msg.sender);
    }

    function pauseMarketplace() external {
        _onlyGuardianOrAdmin();
        marketplacePaused = true;
        emit MarketplacePauseUpdated(true, msg.sender);
    }

    function unpauseMarketplace() external onlyAdmin {
        marketplacePaused = false;
        emit MarketplacePauseUpdated(false, msg.sender);
    }

    function _onlyGuardianOrAdmin() private view {
        if (msg.sender != guardian && msg.sender != admin) revert NotGuardian();
    }

    function _validateFees(uint256 launchFee, uint16 primaryFeeBps, uint16 marketFeeBps) private pure {
        if (
            launchFee > MAX_COLLECTION_LAUNCH_FEE || primaryFeeBps > MAX_PRIMARY_MINT_FEE_BPS
                || marketFeeBps > MAX_MARKETPLACE_FEE_BPS
        ) revert InvalidFee();
    }

    function _clearPendingFeeUpdate() private {
        pendingCollectionLaunchFee = 0;
        pendingPrimaryMintFeeBps = 0;
        pendingMarketplaceFeeBps = 0;
        pendingFeeUpdateTime = 0;
    }
}
