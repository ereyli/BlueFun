// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC1155Market {
    function balanceOf(address account, uint256 tokenId) external view returns (uint256);
    function isApprovedForAll(address account, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 amount);
}
