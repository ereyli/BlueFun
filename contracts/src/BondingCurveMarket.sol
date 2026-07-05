// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20} from "./interfaces/IB20.sol";
import {B20Constants} from "./libraries/B20Constants.sol";
import {Ownable} from "./access/Ownable.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

contract BondingCurveMarket is Ownable, ReentrancyGuard {
    error NotLaunchFactory();
    error NotGraduationManager();
    error LaunchNotFound();
    error TradingClosed();
    error DeadlineExpired();
    error ZeroAmount();
    error Slippage();
    error WalletCapExceeded();
    error AntiSnipingLimit();
    error InsufficientReserve();
    error FeeTooHigh();
    error InvalidLaunchConfig();
    error RefundFailed();
    error EmergencyDelayNotElapsed();
    error EmergencyAlreadyScheduled();
    error EmergencyNotScheduled();
    error InvalidEmergencyRecipient();
    error LaunchEmergencyClosed();

    struct CurveConfig {
        uint256 virtualTokenReserve;
        uint256 virtualEthReserve;
        uint256 graduationEthTarget;
        uint256 maxSupply;
    }

    struct LaunchConfig {
        uint256 perWalletCap;
        uint256 creatorAllocation;
        uint16 platformFeeBps;
        uint16 creatorFeeBps;
        uint64 antiSnipingDuration;
        uint256 antiSnipingMaxBuy;
    }

    struct LaunchState {
        address token;
        address creator;
        uint256 virtualTokenReserve;
        uint256 virtualEthReserve;
        uint256 realEthReserve;
        uint256 graduationEthTarget;
        uint256 maxSupply;
        uint256 perWalletCap;
        uint256 creatorAllocation;
        uint16 platformFeeBps;
        uint16 creatorFeeBps;
        uint64 createdAt;
        uint64 antiSnipingDuration;
        uint256 antiSnipingMaxBuy;
        bool graduationReady;
        bool graduated;
    }

    address public launchFactory;
    address public graduationManager;
    address public feeRecipient;
    uint256 public launchCount;
    uint256 public constant EMERGENCY_DELAY = 48 hours;

    mapping(uint256 launchId => LaunchState) public launches;
    mapping(uint256 launchId => mapping(address trader => uint256 amount)) public purchased;
    mapping(address account => uint256 amount) public pendingFees;
    mapping(uint256 launchId => uint256 unlockTime) public emergencyUnlockAt;
    mapping(uint256 launchId => bool closed) public emergencyClosed;

    event LaunchRegistered(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 graduationEthTarget,
        uint256 maxSupply
    );
    event TokensBought(
        uint256 indexed launchId,
        address indexed buyer,
        uint256 ethIn,
        uint256 tokensOut,
        uint256 platformFee,
        uint256 creatorFee
    );
    event TokensSold(
        uint256 indexed launchId,
        address indexed seller,
        uint256 tokensIn,
        uint256 ethOut,
        uint256 platformFee,
        uint256 creatorFee
    );
    event GraduationReady(uint256 indexed launchId, uint256 realEthReserve);
    event TradingMarkedGraduated(uint256 indexed launchId);
    event FeesClaimed(address indexed account, uint256 amount);
    event EmergencyCloseScheduled(uint256 indexed launchId, uint256 unlockTime);
    event EmergencyCloseCancelled(uint256 indexed launchId);
    event EmergencyClosed(uint256 indexed launchId, address indexed recipient, uint256 ethAmount);

    modifier onlyFactory() {
        if (msg.sender != launchFactory) revert NotLaunchFactory();
        _;
    }

    modifier onlyGraduationManager() {
        if (msg.sender != graduationManager) revert NotGraduationManager();
        _;
    }

    constructor(address initialOwner, address feeRecipient_) Ownable(initialOwner) {
        if (feeRecipient_ == address(0)) revert InvalidLaunchConfig();
        feeRecipient = feeRecipient_;
    }

    receive() external payable {}

    function configure(address launchFactory_, address graduationManager_, address feeRecipient_) external onlyOwner {
        if (launchFactory_ == address(0) || graduationManager_ == address(0) || feeRecipient_ == address(0)) {
            revert InvalidLaunchConfig();
        }
        launchFactory = launchFactory_;
        graduationManager = graduationManager_;
        feeRecipient = feeRecipient_;
    }

    function registerLaunch(address token, address creator, CurveConfig calldata curve, LaunchConfig calldata config)
        external
        onlyFactory
        returns (uint256 launchId)
    {
        if (token == address(0) || creator == address(0)) revert InvalidLaunchConfig();
        if (
            curve.virtualTokenReserve == 0 || curve.virtualEthReserve == 0 || curve.graduationEthTarget == 0
                || curve.maxSupply == 0 || config.perWalletCap == 0
        ) revert InvalidLaunchConfig();
        if (config.platformFeeBps + config.creatorFeeBps > 1_000) revert FeeTooHigh();
        if (config.creatorAllocation >= curve.maxSupply) revert InvalidLaunchConfig();

        launchId = ++launchCount;
        launches[launchId] = LaunchState({
            token: token,
            creator: creator,
            virtualTokenReserve: curve.virtualTokenReserve,
            virtualEthReserve: curve.virtualEthReserve,
            realEthReserve: 0,
            graduationEthTarget: curve.graduationEthTarget,
            maxSupply: curve.maxSupply,
            perWalletCap: config.perWalletCap,
            creatorAllocation: config.creatorAllocation,
            platformFeeBps: config.platformFeeBps,
            creatorFeeBps: config.creatorFeeBps,
            createdAt: uint64(block.timestamp),
            antiSnipingDuration: config.antiSnipingDuration,
            antiSnipingMaxBuy: config.antiSnipingMaxBuy,
            graduationReady: false,
            graduated: false
        });

        emit LaunchRegistered(launchId, token, creator, curve.graduationEthTarget, curve.maxSupply);
    }

    function quoteBuy(uint256 launchId, uint256 ethIn) public view returns (uint256 tokensOut, uint256 netEthIn) {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        if (ethIn == 0) revert ZeroAmount();
        if (launch.graduated || launch.graduationReady) revert TradingClosed();
        uint256 grossEthIn = _cappedGrossEthIn(launch, ethIn);
        (uint256 platformFee, uint256 creatorFee) = _fees(grossEthIn, launch.platformFeeBps, launch.creatorFeeBps);
        netEthIn = grossEthIn - platformFee - creatorFee;
        uint256 k = launch.virtualTokenReserve * launch.virtualEthReserve;
        uint256 newEthReserve = launch.virtualEthReserve + netEthIn;
        tokensOut = launch.virtualTokenReserve - (k / newEthReserve);
    }

    function quoteSell(uint256 launchId, uint256 tokenAmount)
        public
        view
        returns (uint256 ethOut, uint256 grossEthOut)
    {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        if (tokenAmount == 0) revert ZeroAmount();
        uint256 k = launch.virtualTokenReserve * launch.virtualEthReserve;
        uint256 newTokenReserve = launch.virtualTokenReserve + tokenAmount;
        grossEthOut = launch.virtualEthReserve - (k / newTokenReserve);
        (uint256 platformFee, uint256 creatorFee) = _fees(grossEthOut, launch.platformFeeBps, launch.creatorFeeBps);
        ethOut = grossEthOut - platformFee - creatorFee;
    }

    function buy(uint256 launchId, uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        tokensOut = _buy(launchId, msg.sender, minTokensOut, false);
    }

    function initialBuyFor(uint256 launchId, address buyer, uint256 minTokensOut)
        external
        payable
        onlyFactory
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (buyer == address(0)) revert InvalidLaunchConfig();
        tokensOut = _buy(launchId, buyer, minTokensOut, true);
    }

    function _buy(uint256 launchId, address buyer, uint256 minTokensOut, bool bypassLaunchLimits)
        internal
        returns (uint256 tokensOut)
    {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        if (emergencyClosed[launchId]) revert LaunchEmergencyClosed();
        if (launch.graduated || launch.graduationReady) revert TradingClosed();

        uint256 grossEthIn = _cappedGrossEthIn(launch, msg.value);
        uint256 refund = msg.value - grossEthIn;
        (tokensOut,) = quoteBuy(launchId, grossEthIn);
        if (tokensOut < minTokensOut) revert Slippage();
        if (tokensOut == 0) revert ZeroAmount();
        if (!bypassLaunchLimits) {
            if (block.timestamp < launch.createdAt + launch.antiSnipingDuration && launch.antiSnipingMaxBuy > 0) {
                if (tokensOut > launch.antiSnipingMaxBuy) revert AntiSnipingLimit();
            }
            if (purchased[launchId][buyer] + tokensOut > launch.perWalletCap) revert WalletCapExceeded();
        }

        (uint256 platformFee, uint256 creatorFee) = _fees(grossEthIn, launch.platformFeeBps, launch.creatorFeeBps);
        uint256 netEthIn = grossEthIn - platformFee - creatorFee;
        launch.virtualEthReserve += netEthIn;
        launch.virtualTokenReserve -= tokensOut;
        launch.realEthReserve += netEthIn;
        purchased[launchId][buyer] += tokensOut;
        pendingFees[feeRecipient] += platformFee;
        pendingFees[launch.creator] += creatorFee;

        IB20(launch.token).mint(buyer, tokensOut);

        if (refund > 0) {
            (bool refunded,) = buyer.call{value: refund}("");
            if (!refunded) revert RefundFailed();
        }

        emit TokensBought(launchId, buyer, grossEthIn, tokensOut, platformFee, creatorFee);

        if (launch.realEthReserve >= launch.graduationEthTarget) {
            launch.graduationReady = true;
            emit GraduationReady(launchId, launch.realEthReserve);
        }
    }

    function sell(uint256 launchId, uint256 tokenAmount, uint256 minEthOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        if (emergencyClosed[launchId]) revert LaunchEmergencyClosed();
        if (launch.graduated || launch.graduationReady) revert TradingClosed();

        uint256 grossEthOut;
        (ethOut, grossEthOut) = quoteSell(launchId, tokenAmount);
        if (ethOut < minEthOut) revert Slippage();
        if (grossEthOut > launch.realEthReserve) revert InsufficientReserve();

        (uint256 platformFee, uint256 creatorFee) = _fees(grossEthOut, launch.platformFeeBps, launch.creatorFeeBps);
        launch.virtualEthReserve -= grossEthOut;
        launch.virtualTokenReserve += tokenAmount;
        launch.realEthReserve -= grossEthOut;
        pendingFees[feeRecipient] += platformFee;
        pendingFees[launch.creator] += creatorFee;

        IB20(launch.token).transferFrom(msg.sender, address(this), tokenAmount);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert InsufficientReserve();

        emit TokensSold(launchId, msg.sender, tokenAmount, ethOut, platformFee, creatorFee);
    }

    function graduationLiquidity(uint256 launchId)
        external
        view
        returns (address token, address creator, uint256 ethAmount, uint256 tokenAmount, uint256 creatorAllocation)
    {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        uint256 minted = IB20(launch.token).totalSupply();
        uint256 available = launch.maxSupply > minted + launch.creatorAllocation
            ? launch.maxSupply - minted - launch.creatorAllocation
            : 0;
        return (launch.token, launch.creator, launch.realEthReserve, available, launch.creatorAllocation);
    }

    function markGraduated(uint256 launchId) external onlyGraduationManager {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        launch.graduationReady = true;
        launch.graduated = true;
        launch.realEthReserve = 0;
        emit TradingMarkedGraduated(launchId);
    }

    function withdrawGraduationEth(uint256 launchId, address payable to) external onlyGraduationManager returns (uint256 amount) {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        amount = launch.realEthReserve;
        launch.realEthReserve = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert InsufficientReserve();
    }

    function claimFees() external nonReentrant returns (uint256 amount) {
        amount = pendingFees[msg.sender];
        if (amount == 0) revert ZeroAmount();
        pendingFees[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert InsufficientReserve();
        emit FeesClaimed(msg.sender, amount);
    }

    function scheduleEmergencyClose(uint256 launchId) external onlyOwner {
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        if (launch.graduated || launch.graduationReady) revert TradingClosed();
        if (emergencyClosed[launchId]) revert LaunchEmergencyClosed();
        if (emergencyUnlockAt[launchId] != 0) revert EmergencyAlreadyScheduled();

        uint256 unlockTime = block.timestamp + EMERGENCY_DELAY;
        emergencyUnlockAt[launchId] = unlockTime;
        emit EmergencyCloseScheduled(launchId, unlockTime);
    }

    function cancelEmergencyClose(uint256 launchId) external onlyOwner {
        if (emergencyUnlockAt[launchId] == 0) revert EmergencyNotScheduled();
        delete emergencyUnlockAt[launchId];
        emit EmergencyCloseCancelled(launchId);
    }

    function emergencyCloseUnbonded(uint256 launchId, address payable recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amount)
    {
        if (recipient == address(0)) revert InvalidEmergencyRecipient();
        LaunchState storage launch = launches[launchId];
        if (launch.token == address(0)) revert LaunchNotFound();
        if (launch.graduated || launch.graduationReady) revert TradingClosed();
        if (emergencyClosed[launchId]) revert LaunchEmergencyClosed();

        uint256 unlockTime = emergencyUnlockAt[launchId];
        if (unlockTime == 0) revert EmergencyNotScheduled();
        if (block.timestamp < unlockTime) revert EmergencyDelayNotElapsed();

        amount = launch.realEthReserve;
        emergencyClosed[launchId] = true;
        launch.realEthReserve = 0;
        delete emergencyUnlockAt[launchId];

        if (amount > 0) {
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert InsufficientReserve();
        }

        emit EmergencyClosed(launchId, recipient, amount);
    }

    function _fees(uint256 amount, uint16 platformFeeBps, uint16 creatorFeeBps)
        internal
        pure
        returns (uint256 platformFee, uint256 creatorFee)
    {
        platformFee = (amount * platformFeeBps) / B20Constants.BPS;
        creatorFee = (amount * creatorFeeBps) / B20Constants.BPS;
    }

    function _cappedGrossEthIn(LaunchState storage launch, uint256 ethIn) internal view returns (uint256 grossEthIn) {
        if (ethIn == 0) revert ZeroAmount();
        uint256 remainingNetEth = launch.graduationEthTarget > launch.realEthReserve
            ? launch.graduationEthTarget - launch.realEthReserve
            : 0;
        if (remainingNetEth == 0) revert TradingClosed();

        uint16 feeBps = launch.platformFeeBps + launch.creatorFeeBps;
        uint256 grossNeeded = _grossForNet(remainingNetEth, feeBps);
        grossEthIn = ethIn > grossNeeded ? grossNeeded : ethIn;
    }

    function _grossForNet(uint256 netAmount, uint16 feeBps) internal pure returns (uint256) {
        uint256 denominator = B20Constants.BPS - feeBps;
        return (netAmount * B20Constants.BPS + denominator - 1) / denominator;
    }
}
