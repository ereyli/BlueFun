// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IBlueEdition1155 {
    function owner() external view returns (address);
    function payoutRecipient() external view returns (address);
    function maxSupply(uint256 tokenId) external view returns (uint256);
    function lifetimeMinted(uint256 tokenId) external view returns (uint256);
    function mintByController(address to, uint256 tokenId, uint256 quantity, bytes calldata data) external;
}
