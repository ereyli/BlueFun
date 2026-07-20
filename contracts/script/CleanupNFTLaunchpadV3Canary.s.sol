// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BlueEdition1155} from "../src/BlueEdition1155.sol";
import {BluePFP721} from "../src/BluePFP721.sol";

interface IWETHCanaryCleanup {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function withdraw(uint256 amount) external;
}

interface VmNFTV3CanaryCleanup {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external pure returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Revokes the temporary approvals used by the Base mainnet V3 canary.
contract CleanupNFTLaunchpadV3Canary {
    VmNFTV3CanaryCleanup private constant vm =
        VmNFTV3CanaryCleanup(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant EDITION = 0xca9f476Edbc85709656112f14906db281Be5e3c7;
    address private constant PFP = 0xa958d9E63310574c81e9ee181C40e1669cBc9BD1;
    address private constant EDITION_MARKET = 0x0B68d3aE48d8f1880CC79Aa8190F41516dbDE5Dc;
    address private constant PFP_MARKET = 0x6420b1C74029927DF9Ba552445094e15788bA76c;
    address private constant OFFERS = 0x72dB1Ef886b1880C89cBE54cAA48AA6B6DdF932E;
    address private constant WETH = 0x4200000000000000000000000000000000000006;
    address private constant CREATOR = 0x9d5f55a644eF0eB9FF82dbd14Dd0471de3ff5bfb;
    address private constant BUYER = 0x6d5C7C444d130554Ab195F1D64c3b6D054BF19F8;

    function run() external {
        uint256 creatorKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 buyerKey = vm.envUint("NFT_CANARY_BUYER_PRIVATE_KEY");
        require(vm.addr(creatorKey) == CREATOR, "WRONG_CREATOR");
        require(vm.addr(buyerKey) == BUYER, "WRONG_BUYER");

        vm.startBroadcast(buyerKey);
        BlueEdition1155(EDITION).setApprovalForAll(EDITION_MARKET, false);
        BluePFP721(PFP).setApprovalForAll(PFP_MARKET, false);
        require(IWETHCanaryCleanup(WETH).approve(OFFERS, 0), "WETH_REVOKE_FAILED");
        uint256 wethBalance = IWETHCanaryCleanup(WETH).balanceOf(BUYER);
        if (wethBalance != 0) IWETHCanaryCleanup(WETH).withdraw(wethBalance);
        vm.stopBroadcast();

        vm.startBroadcast(creatorKey);
        BlueEdition1155(EDITION).setApprovalForAll(OFFERS, false);
        vm.stopBroadcast();
    }
}
