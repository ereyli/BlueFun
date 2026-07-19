// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../BondingCurveMarket.sol";
import {StandardLaunchToken} from "../StandardLaunchToken.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";
import {ArcDexAdapterRegistry} from "./ArcDexAdapterRegistry.sol";
import {IArcBondDexAdapter} from "./IArcDexAdapter.sol";

/// @notice Fixed-economics Arc Bond launch factory using native USDC.
contract ArcBondLaunchFactory is ReentrancyGuard {
    error InvalidLaunchConfig();
    error UnsafeCreatorAllocation();
    error UnsafeCurveConfig();
    error UnsafeTradingConfig();
    error InitialBuyTooLarge();
    error InsufficientLaunchFee();
    error LaunchesPaused();
    error AdapterNotFrozen();
    error AdapterNotReady();

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    BondingCurveMarket public immutable market;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    address public immutable graduationCoordinator;
    ArcDexAdapterRegistry public immutable adapterRegistry;

    uint256 public constant GRADUATION_USDC_TARGET = 5_000 ether;
    uint256 public constant VIRTUAL_TOKEN_RESERVE = 1_000_000_000 ether;
    uint256 public constant VIRTUAL_USDC_RESERVE = 1_250 ether;
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant PER_WALLET_CAP = 900_000_000 ether;
    uint256 public constant CREATOR_ALLOCATION = 0;
    uint256 public constant MAX_INITIAL_BUY_USDC = GRADUATION_USDC_TARGET;
    uint64 public constant ANTI_SNIPING_DURATION = 60;
    uint256 public constant ANTI_SNIPING_MAX_BUY = 500_000_000 ether;

    event ArcBondLaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string contractURI
    );
    event ArcLaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 usdcAmount);
    event ArcCreatorInitialBuy(uint256 indexed launchId, address indexed creator, uint256 usdcAmount);

    constructor(
        BondingCurveMarket market_,
        address graduationCoordinator_,
        ArcDexAdapterRegistry adapterRegistry_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_
    ) {
        if (
            address(market_) == address(0) || graduationCoordinator_ == address(0)
                || address(adapterRegistry_) == address(0) || address(feePolicy_) == address(0)
                || address(revenueRouter_) == address(0)
        ) revert InvalidLaunchConfig();
        market = market_;
        graduationCoordinator = graduationCoordinator_;
        adapterRegistry = adapterRegistry_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
    }

    function launchFee() external view returns (uint256) {
        return feePolicy.launchFee();
    }

    function predictTokenAddress(address creator, TokenMetadata calldata metadata) external view returns (address) {
        bytes32 effectiveSalt = keccak256(abi.encode(creator, block.chainid, metadata.salt));
        bytes memory init = abi.encodePacked(
            type(StandardLaunchToken).creationCode,
            abi.encode(metadata.name, metadata.symbol, metadata.contractURI, address(market), MAX_SUPPLY)
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), effectiveSalt, keccak256(init)))))
        );
    }

    function createLaunch(
        TokenMetadata calldata metadata,
        BondingCurveMarket.CurveConfig calldata curve,
        BondingCurveMarket.LaunchConfig calldata config
    ) external payable nonReentrant returns (uint256 launchId, address token) {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        if (!adapterRegistry.bondAdapterFrozen()) revert AdapterNotFrozen();
        if (!IArcBondDexAdapter(adapterRegistry.bondAdapter()).isReady()) revert AdapterNotReady();
        _validateMetadata(metadata);
        if (
            curve.virtualTokenReserve != VIRTUAL_TOKEN_RESERVE || curve.virtualEthReserve != VIRTUAL_USDC_RESERVE
                || curve.graduationEthTarget != GRADUATION_USDC_TARGET || curve.maxSupply != MAX_SUPPLY
        ) revert UnsafeCurveConfig();
        if (
            config.perWalletCap != PER_WALLET_CAP || config.creatorAllocation != CREATOR_ALLOCATION
                || config.antiSnipingDuration != ANTI_SNIPING_DURATION
                || config.antiSnipingMaxBuy != ANTI_SNIPING_MAX_BUY
        ) revert UnsafeTradingConfig();

        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value < currentLaunchFee) revert InsufficientLaunchFee();
        uint256 initialBuyValue = msg.value - currentLaunchFee;
        if (initialBuyValue > MAX_INITIAL_BUY_USDC) revert InitialBuyTooLarge();
        if (curve.maxSupply == 0 || config.creatorAllocation != 0) revert UnsafeCreatorAllocation();

        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, metadata.salt));
        token = address(
            new StandardLaunchToken{salt: effectiveSalt}(
                metadata.name, metadata.symbol, metadata.contractURI, address(market), curve.maxSupply
            )
        );
        BondingCurveMarket.LaunchConfig memory fixedConfig = config;
        fixedConfig.platformFeeBps = feePolicy.buyPlatformFeeBps();
        fixedConfig.creatorFeeBps = feePolicy.buyCreatorFeeBps();
        launchId = market.registerLaunch(token, msg.sender, curve, fixedConfig);

        if (currentLaunchFee != 0) revenueRouter.depositLaunchRevenue{value: currentLaunchFee}();
        emit ArcLaunchFeePaid(launchId, msg.sender, currentLaunchFee);
        if (initialBuyValue != 0) {
            market.initialBuyFor{value: initialBuyValue}(launchId, msg.sender, 0);
            emit ArcCreatorInitialBuy(launchId, msg.sender, initialBuyValue);
        }
        emit ArcBondLaunchCreated(launchId, token, msg.sender, metadata.name, metadata.symbol, metadata.contractURI);
    }

    function _validateMetadata(TokenMetadata calldata metadata) private pure {
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40 || bytes(metadata.symbol).length == 0
                || bytes(metadata.symbol).length > 10 || bytes(metadata.contractURI).length == 0
                || bytes(metadata.contractURI).length > 512
        ) revert InvalidLaunchConfig();
    }
}
