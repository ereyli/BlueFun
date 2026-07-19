// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20Offers {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
