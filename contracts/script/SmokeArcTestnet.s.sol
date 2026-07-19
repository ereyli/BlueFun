// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {StandardLaunchToken} from "../src/StandardLaunchToken.sol";
import {ArcBondLaunchFactory} from "../src/arc/ArcBondLaunchFactory.sol";
import {ArcDirectLaunchFactory} from "../src/arc/ArcDirectLaunchFactory.sol";
import {ArcTestnetDexAdapter} from "../src/arc/ArcTestnetDexAdapter.sol";

interface VmArcTestnetSmoke {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Executes real Arc Testnet Bond and Direct launch/buy/sell smoke tests.
/// @dev This script targets only the isolated ArcTestnetDexAdapter deployment.
contract SmokeArcTestnet {
    VmArcTestnetSmoke private constant VM = VmArcTestnetSmoke(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant LAUNCH_FEE = 2 ether;
    uint256 private constant INITIAL_BUY = 0.2 ether;

    event ArcTestnetSmokeCompleted(
        uint256 bondLaunchId,
        address bondToken,
        uint256 bondTokensBought,
        uint256 bondTokensSold,
        uint256 directLaunchId,
        address directToken,
        uint256 directTokensBought,
        uint256 directTokensSold
    );

    function run() external {
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        ArcBondLaunchFactory bondFactory = ArcBondLaunchFactory(VM.envAddress("ARC_BOND_FACTORY"));
        BondingCurveMarket market = BondingCurveMarket(payable(VM.envAddress("ARC_BOND_MARKET")));
        ArcDirectLaunchFactory directFactory = ArcDirectLaunchFactory(VM.envAddress("ARC_DIRECT_FACTORY"));
        ArcTestnetDexAdapter adapter = ArcTestnetDexAdapter(payable(VM.envAddress("ARC_TESTNET_DEX_ADAPTER")));

        VM.startBroadcast(key);

        ArcBondLaunchFactory.TokenMetadata memory bondMetadata = ArcBondLaunchFactory.TokenMetadata({
            name: "Bluefun Arc Bond Test",
            symbol: "ABOND",
            contractURI: "ipfs://bluefun-arc-testnet/bond-v1",
            salt: keccak256("bluefun-arc-testnet-bond-smoke-v1")
        });
        BondingCurveMarket.CurveConfig memory curve = BondingCurveMarket.CurveConfig({
            virtualTokenReserve: 1_000_000_000 ether,
            virtualEthReserve: 1_250 ether,
            graduationEthTarget: 5_000 ether,
            maxSupply: 1_000_000_000 ether
        });
        BondingCurveMarket.LaunchConfig memory launchConfig = BondingCurveMarket.LaunchConfig({
            perWalletCap: 900_000_000 ether,
            creatorAllocation: 0,
            platformFeeBps: 70,
            creatorFeeBps: 30,
            antiSnipingDuration: 60,
            antiSnipingMaxBuy: 500_000_000 ether
        });
        (uint256 bondLaunchId, address bondToken) =
            bondFactory.createLaunch{value: LAUNCH_FEE + INITIAL_BUY}(bondMetadata, curve, launchConfig);
        uint256 bondTokensBought = StandardLaunchToken(bondToken).balanceOf(deployer);
        uint256 bondTokensSold = bondTokensBought / 2;
        StandardLaunchToken(bondToken).approve(address(market), bondTokensSold);
        market.sell(bondLaunchId, bondTokensSold, 0, block.timestamp + 1 hours);

        ArcDirectLaunchFactory.TokenMetadata memory directMetadata = ArcDirectLaunchFactory.TokenMetadata({
            name: "Bluefun Arc Direct Test",
            symbol: "ADIRECT",
            contractURI: "ipfs://bluefun-arc-testnet/direct-v1",
            salt: keccak256("bluefun-arc-testnet-direct-smoke-v1")
        });
        (uint256 directLaunchId, address directToken,,) = directFactory.createLaunchWithInitialBuy{
            value: LAUNCH_FEE + INITIAL_BUY
        }(
            directMetadata, block.timestamp + 1 hours, 0
        );
        uint256 directTokensBought = StandardLaunchToken(directToken).balanceOf(deployer);
        uint256 directTokensSold = directTokensBought / 2;
        StandardLaunchToken(directToken).approve(address(adapter), directTokensSold);
        adapter.sell(directToken, directTokensSold, 0, block.timestamp + 1 hours);

        VM.stopBroadcast();

        emit ArcTestnetSmokeCompleted(
            bondLaunchId,
            bondToken,
            bondTokensBought,
            bondTokensSold,
            directLaunchId,
            directToken,
            directTokensBought,
            directTokensSold
        );
    }
}
