// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20} from "./interfaces/IB20.sol";
import {IB20Factory} from "./interfaces/IB20Factory.sol";
import {IActivationRegistry} from "./interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {PolicyGuard} from "./PolicyGuard.sol";
import {B20Constants} from "./libraries/B20Constants.sol";
import {Ownable} from "./access/Ownable.sol";

contract LaunchFactory is Ownable, PolicyGuard {
    error B20AssetNotActivated();
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

    IB20Factory public immutable b20Factory;
    IActivationRegistry public immutable activationRegistry;
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
    bool public activationGateEnabled = true;
    uint16 public maxCreatorAllocationBps = 1_500;
    uint256 public pendingLaunchFees;

    event LaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string contractURI
    );
    event ActivationGateUpdated(bool enabled);
    event MaxCreatorAllocationUpdated(uint16 maxCreatorAllocationBps);
    event LaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 amount);
    event LaunchFeesClaimed(address indexed recipient, uint256 amount);

    constructor(
        address initialOwner,
        IB20Factory b20Factory_,
        IActivationRegistry activationRegistry_,
        IPolicyRegistry policyRegistry_,
        BondingCurveMarket market_,
        address graduationManager_,
        address payable launchFeeRecipient_
    ) Ownable(initialOwner) PolicyGuard(policyRegistry_) {
        if (
            address(b20Factory_) == address(0) || address(market_) == address(0) || graduationManager_ == address(0)
                || launchFeeRecipient_ == address(0)
        ) {
            revert InvalidLaunchConfig();
        }
        b20Factory = b20Factory_;
        activationRegistry = activationRegistry_;
        market = market_;
        graduationManager = graduationManager_;
        launchFeeRecipient = launchFeeRecipient_;
    }

    function setActivationGateEnabled(bool enabled) external onlyOwner {
        activationGateEnabled = enabled;
        emit ActivationGateUpdated(enabled);
    }

    function setMaxCreatorAllocationBps(uint16 value) external onlyOwner {
        if (value > 2_000) revert UnsafeCreatorAllocation();
        maxCreatorAllocationBps = value;
        emit MaxCreatorAllocationUpdated(value);
    }

    function predictTokenAddress(bytes32 salt) external view returns (address) {
        return b20Factory.getB20Address(IB20Factory.B20Variant.ASSET, address(this), salt);
    }

    function createLaunch(
        TokenMetadata calldata metadata,
        BondingCurveMarket.CurveConfig calldata curve,
        BondingCurveMarket.LaunchConfig calldata config
    ) external payable returns (uint256 launchId, address token) {
        if (activationGateEnabled && !activationRegistry.isActivated(B20Constants.B20_ASSET_FEATURE)) {
            revert B20AssetNotActivated();
        }
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.symbol).length == 0
                || bytes(metadata.contractURI).length == 0
        ) {
            revert InvalidLaunchConfig();
        }
        if (
            curve.virtualTokenReserve != VIRTUAL_TOKEN_RESERVE || curve.virtualEthReserve != VIRTUAL_ETH_RESERVE
                || curve.maxSupply != MAX_SUPPLY
        ) {
            revert UnsafeCurveConfig();
        }
        if (
            config.perWalletCap != PER_WALLET_CAP || config.creatorAllocation != CREATOR_ALLOCATION
                || config.platformFeeBps != PLATFORM_FEE_BPS || config.creatorFeeBps != CREATOR_FEE_BPS
                || config.antiSnipingDuration != ANTI_SNIPING_DURATION
                || config.antiSnipingMaxBuy != ANTI_SNIPING_MAX_BUY
        ) {
            revert UnsafeTradingConfig();
        }
        if (msg.value < LAUNCH_FEE) {
            revert InsufficientLaunchFee();
        }
        uint256 initialBuyValue = msg.value - LAUNCH_FEE;
        if (initialBuyValue > MAX_INITIAL_BUY_ETH) {
            revert InitialBuyTooLarge();
        }
        if (
            curve.maxSupply == 0
                || config.creatorAllocation > (curve.maxSupply * maxCreatorAllocationBps) / B20Constants.BPS
        ) {
            revert UnsafeCreatorAllocation();
        }

        bytes[] memory initCalls = new bytes[](5);
        IB20Factory.B20AssetCreateParams memory params = IB20Factory.B20AssetCreateParams({
            version: 1, name: metadata.name, symbol: metadata.symbol, initialAdmin: graduationManager, decimals: 18
        });

        bytes memory encodedParams = abi.encode(params);
        bytes32 mintRole = keccak256("MINT_ROLE");
        initCalls[0] = abi.encodeCall(IB20.updateSupplyCap, (curve.maxSupply));
        initCalls[1] = abi.encodeCall(IB20.updateContractURI, (metadata.contractURI));
        initCalls[2] = abi.encodeCall(IB20.grantRole, (mintRole, address(b20Factory)));
        initCalls[3] = abi.encodeCall(IB20.mint, (address(market), curve.maxSupply));
        initCalls[4] = abi.encodeCall(IB20.revokeRole, (mintRole, address(b20Factory)));

        token = b20Factory.createB20(IB20Factory.B20Variant.ASSET, metadata.salt, encodedParams, initCalls);
        BondingCurveMarket.CurveConfig memory fixedCurve = BondingCurveMarket.CurveConfig({
            virtualTokenReserve: curve.virtualTokenReserve,
            virtualEthReserve: curve.virtualEthReserve,
            graduationEthTarget: GRADUATION_ETH_TARGET,
            maxSupply: curve.maxSupply
        });
        launchId = market.registerLaunch(token, msg.sender, fixedCurve, config);
        pendingLaunchFees += LAUNCH_FEE;
        emit LaunchFeePaid(launchId, msg.sender, LAUNCH_FEE);

        if (initialBuyValue > 0) {
            market.initialBuyFor{value: initialBuyValue}(launchId, msg.sender, 0);
        }

        emit LaunchCreated(launchId, token, msg.sender, metadata.name, metadata.symbol, metadata.contractURI);
    }

    function claimLaunchFees() external onlyOwner returns (uint256 amount) {
        amount = pendingLaunchFees;
        if (amount == 0) revert InsufficientLaunchFee();
        pendingLaunchFees = 0;
        (bool ok,) = launchFeeRecipient.call{value: amount}("");
        if (!ok) revert LaunchFeeClaimFailed();
        emit LaunchFeesClaimed(launchFeeRecipient, amount);
    }
}
