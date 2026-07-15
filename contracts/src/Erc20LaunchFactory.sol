// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {StandardLaunchToken} from "./StandardLaunchToken.sol";
import {Ownable} from "./access/Ownable.sol";
import {B20Constants} from "./libraries/B20Constants.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

contract Erc20LaunchFactory is Ownable, ReentrancyGuard {
    error InvalidLaunchConfig();
    error UnsafeCreatorAllocation();
    error UnsafeCurveConfig();
    error UnsafeTradingConfig();
    error InitialBuyTooLarge();
    error InsufficientLaunchFee();
    error LaunchFeeClaimFailed();

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    BondingCurveMarket public immutable market;
    address public immutable graduationManager;
    address payable public immutable launchFeeRecipient;
    uint256 public constant GRADUATION_ETH_TARGET = 5 ether;
    uint256 public constant LAUNCH_FEE = 0.002 ether;
    uint256 public constant VIRTUAL_TOKEN_RESERVE = 1_000_000_000 ether;
    uint256 public constant VIRTUAL_ETH_RESERVE = 1.25 ether;
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant PER_WALLET_CAP = 900_000_000 ether;
    uint256 public constant CREATOR_ALLOCATION = 0;
    uint256 public constant MAX_INITIAL_BUY_ETH = GRADUATION_ETH_TARGET;
    uint16 public constant PLATFORM_FEE_BPS = 70;
    uint16 public constant CREATOR_FEE_BPS = 30;
    uint64 public constant ANTI_SNIPING_DURATION = 60;
    uint256 public constant ANTI_SNIPING_MAX_BUY = 500_000_000 ether;
    uint256 public pendingLaunchFees;

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string contractURI
    );
    event LaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 amount);
    event LaunchFeesClaimed(address indexed recipient, uint256 amount);

    constructor(
        address initialOwner,
        BondingCurveMarket market_,
        address graduationManager_,
        address payable launchFeeRecipient_
    ) Ownable(initialOwner) {
        if (address(market_) == address(0) || graduationManager_ == address(0) || launchFeeRecipient_ == address(0)) revert InvalidLaunchConfig();
        market = market_;
        graduationManager = graduationManager_;
        launchFeeRecipient = launchFeeRecipient_;
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
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40 || bytes(metadata.symbol).length == 0
                || bytes(metadata.symbol).length > 10 || bytes(metadata.contractURI).length == 0
                || bytes(metadata.contractURI).length > 512
        ) revert InvalidLaunchConfig();
        if (
            curve.virtualTokenReserve != VIRTUAL_TOKEN_RESERVE || curve.virtualEthReserve != VIRTUAL_ETH_RESERVE
                || curve.maxSupply != MAX_SUPPLY
        ) revert UnsafeCurveConfig();
        if (
            config.perWalletCap != PER_WALLET_CAP || config.creatorAllocation != CREATOR_ALLOCATION
                || config.platformFeeBps != PLATFORM_FEE_BPS || config.creatorFeeBps != CREATOR_FEE_BPS
                || config.antiSnipingDuration != ANTI_SNIPING_DURATION
                || config.antiSnipingMaxBuy != ANTI_SNIPING_MAX_BUY
        ) revert UnsafeTradingConfig();
        if (msg.value < LAUNCH_FEE) revert InsufficientLaunchFee();
        uint256 initialBuyValue = msg.value - LAUNCH_FEE;
        if (initialBuyValue > MAX_INITIAL_BUY_ETH) revert InitialBuyTooLarge();
        if (curve.maxSupply == 0 || config.creatorAllocation != 0) revert UnsafeCreatorAllocation();

        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, metadata.salt));
        token = address(
            new StandardLaunchToken{salt: effectiveSalt}(
                metadata.name, metadata.symbol, metadata.contractURI, address(market), curve.maxSupply
            )
        );
        BondingCurveMarket.CurveConfig memory fixedCurve = BondingCurveMarket.CurveConfig(
            curve.virtualTokenReserve, curve.virtualEthReserve, GRADUATION_ETH_TARGET, curve.maxSupply
        );
        launchId = market.registerLaunch(token, msg.sender, fixedCurve, config);
        pendingLaunchFees += LAUNCH_FEE;
        emit LaunchFeePaid(launchId, msg.sender, LAUNCH_FEE);
        if (initialBuyValue > 0) market.initialBuyFor{value: initialBuyValue}(launchId, msg.sender, 0);
        emit LaunchCreated(launchId, token, msg.sender, metadata.name, metadata.symbol, metadata.contractURI);
    }

    function claimLaunchFees() external returns (uint256 amount) {
        amount = pendingLaunchFees;
        if (amount == 0) revert InsufficientLaunchFee();
        pendingLaunchFees = 0;
        (bool ok,) = launchFeeRecipient.call{value: amount}("");
        if (!ok) revert LaunchFeeClaimFailed();
        emit LaunchFeesClaimed(launchFeeRecipient, amount);
    }
}
