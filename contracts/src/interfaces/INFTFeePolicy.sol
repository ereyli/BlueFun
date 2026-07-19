// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface INFTFeePolicy {
    function platformWallet() external view returns (address payable);
    function collectionLaunchFee() external view returns (uint256);
    function primaryMintFeeBps() external view returns (uint16);
    function marketplaceFeeBps() external view returns (uint16);
    function newCollectionsPaused() external view returns (bool);
    function newMintsPaused() external view returns (bool);
    function marketplacePaused() external view returns (bool);
}
