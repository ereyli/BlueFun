// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC721Market {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 amount);
}
