// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "./access/TwoStepAdmin.sol";
import {INFTFeePolicy} from "./interfaces/INFTFeePolicy.sol";

/// @notice Bounded policy for BlueFun NFT collection creation, primary mint and marketplace fees.
/// @dev The default deployment assigns admin and guardian roles to the same platform wallet.
contract NFTFeePolicy is TwoStepAdmin, INFTFeePolicy {
    error InvalidAddress();
    error InvalidFee();
    error NotGuardian();

    uint16 public constant BPS = 10_000;
    uint256 public constant MAX_COLLECTION_LAUNCH_FEE = 0.01 ether;
    uint16 public constant MAX_PRIMARY_MINT_FEE_BPS = 500; // 5% permanent admin ceiling.
    uint16 public constant MAX_MARKETPLACE_FEE_BPS = 100; // 1%

    address public guardian;
    address payable public platformWallet;
    uint256 public collectionLaunchFee = 0.001 ether;
    uint16 public primaryMintFeeBps = 200; // 2%.
    uint16 public marketplaceFeeBps = 80; // 0.8%, twenty percent below OpenSea's current 1%.
    bool public newCollectionsPaused;
    bool public newMintsPaused;
    bool public marketplacePaused;

    event CollectionLaunchFeeUpdated(uint256 previousFee, uint256 newFee);
    event PlatformFeesUpdated(
        uint16 previousPrimaryFeeBps,
        uint16 newPrimaryFeeBps,
        uint16 previousMarketplaceFeeBps,
        uint16 newMarketplaceFeeBps
    );
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event PlatformWalletUpdated(address indexed previousWallet, address indexed newWallet);
    event NewCollectionPauseUpdated(bool paused, address indexed caller);
    event NewMintPauseUpdated(bool paused, address indexed caller);
    event MarketplacePauseUpdated(bool paused, address indexed caller);

    constructor(address admin_, address guardian_, address payable platformWallet_) TwoStepAdmin(admin_) {
        if (guardian_ == address(0) || platformWallet_ == address(0)) revert InvalidAddress();
        guardian = guardian_;
        platformWallet = platformWallet_;
    }

    function setCollectionLaunchFee(uint256 newFee) external onlyAdmin {
        if (newFee > MAX_COLLECTION_LAUNCH_FEE) revert InvalidFee();
        uint256 previous = collectionLaunchFee;
        collectionLaunchFee = newFee;
        emit CollectionLaunchFeeUpdated(previous, newFee);
    }

    function setPlatformFees(uint16 newPrimaryFeeBps, uint16 newMarketplaceFeeBps) external onlyAdmin {
        if (newPrimaryFeeBps > MAX_PRIMARY_MINT_FEE_BPS || newMarketplaceFeeBps > MAX_MARKETPLACE_FEE_BPS) {
            revert InvalidFee();
        }
        uint16 previousPrimary = primaryMintFeeBps;
        uint16 previousMarketplace = marketplaceFeeBps;
        primaryMintFeeBps = newPrimaryFeeBps;
        marketplaceFeeBps = newMarketplaceFeeBps;
        emit PlatformFeesUpdated(previousPrimary, newPrimaryFeeBps, previousMarketplace, newMarketplaceFeeBps);
    }

    function setGuardian(address newGuardian) external onlyAdmin {
        if (newGuardian == address(0)) revert InvalidAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setPlatformWallet(address payable newWallet) external onlyAdmin {
        if (newWallet == address(0)) revert InvalidAddress();
        emit PlatformWalletUpdated(platformWallet, newWallet);
        platformWallet = newWallet;
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
}
