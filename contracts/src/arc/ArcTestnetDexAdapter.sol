// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";
import {IArcBondDexAdapter, IArcDirectDexAdapter} from "./IArcDexAdapter.sol";

interface IArcTestnetToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Isolated constant-product adapter for Arc Testnet end-to-end testing.
/// @dev This is not Uniswap and must never be used or presented as the mainnet
///      DEX integration. Liquidity principal has no withdrawal path.
contract ArcTestnetDexAdapter is IArcBondDexAdapter, IArcDirectDexAdapter, ReentrancyGuard {
    error NotOwner();
    error NotBondCoordinator();
    error NotDirectFactory();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidConfig();
    error InvalidPool();
    error PoolAlreadyExists();
    error DeadlineExpired();
    error ZeroAmount();
    error Slippage();
    error InsufficientLiquidity();
    error TokenTransferFailed();
    error UsdcTransferFailed();

    uint16 public constant BPS = 10_000;
    uint256 public constant DIRECT_VIRTUAL_USDC_RESERVE = 1_250 ether;
    address public constant DEAD_WALLET = 0x000000000000000000000000000000000000dEaD;

    struct Pool {
        uint256 launchId;
        address creator;
        bytes32 positionId;
        uint256 tokenReserve;
        uint256 realUsdcReserve;
        uint256 virtualUsdcReserve;
        bool bondPool;
        bool exists;
    }

    address public owner;
    address public bondCoordinator;
    address public directFactory;
    bool public callersFrozen;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    bytes32 public immutable directConfigHash;

    mapping(address token => Pool pool) public pools;
    mapping(address creator => uint256 amount) public pendingCreatorUsdc;

    event CallersConfigured(address indexed bondCoordinator, address indexed directFactory);
    event CallersFrozen(address indexed bondCoordinator, address indexed directFactory);
    event TestnetPoolCreated(
        address indexed token,
        uint256 indexed launchId,
        address indexed creator,
        bool bondPool,
        uint256 tokenReserve,
        uint256 realUsdcReserve,
        uint256 virtualUsdcReserve,
        bytes32 positionId
    );
    event TestnetTokensBought(
        address indexed token,
        address indexed buyer,
        uint256 grossUsdcIn,
        uint256 tokensOut,
        uint256 platformFee,
        uint256 creatorFee
    );
    event TestnetTokensSold(
        address indexed token,
        address indexed seller,
        uint256 tokensIn,
        uint256 usdcOut,
        uint256 platformFee,
        uint256 tokenBurned
    );
    event CreatorUsdcClaimed(address indexed creator, address indexed recipient, uint256 amount);

    constructor(address owner_, IFeePolicy feePolicy_, IRevenueRouter revenueRouter_) {
        if (owner_ == address(0) || address(feePolicy_) == address(0) || address(revenueRouter_) == address(0)) {
            revert InvalidAddress();
        }
        owner = owner_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
        directConfigHash = keccak256(abi.encode("BLUEFUN_ARC_TESTNET_CPAMM_V1", DIRECT_VIRTUAL_USDC_RESERVE));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function configureCallers(address bondCoordinator_, address directFactory_) external onlyOwner {
        if (callersFrozen || bondCoordinator != address(0) || directFactory != address(0)) revert AlreadyConfigured();
        if (bondCoordinator_ == address(0) || directFactory_ == address(0)) revert InvalidAddress();
        bondCoordinator = bondCoordinator_;
        directFactory = directFactory_;
        emit CallersConfigured(bondCoordinator_, directFactory_);
    }

    function freezeCallers() external onlyOwner {
        if (callersFrozen) revert AlreadyConfigured();
        if (bondCoordinator == address(0) || directFactory == address(0)) revert InvalidAddress();
        callersFrozen = true;
        owner = address(0);
        emit CallersFrozen(bondCoordinator, directFactory);
    }

    function isReady() external view returns (bool) {
        return callersFrozen;
    }

    function lockBondLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        payable
        nonReentrant
        returns (bytes32 positionId)
    {
        if (msg.sender != bondCoordinator) revert NotBondCoordinator();
        if (!callersFrozen) revert InvalidConfig();
        if (token == address(0) || creator == address(0)) revert InvalidAddress();
        if (tokenAmount == 0 || msg.value == 0) revert ZeroAmount();
        if (pools[token].exists) revert PoolAlreadyExists();
        if (IArcTestnetToken(token).balanceOf(address(this)) < tokenAmount) revert InsufficientLiquidity();

        positionId = keccak256(abi.encode("ARC_TESTNET_BOND", block.chainid, launchId, token));
        pools[token] = Pool({
            launchId: launchId,
            creator: creator,
            positionId: positionId,
            tokenReserve: tokenAmount,
            realUsdcReserve: msg.value,
            virtualUsdcReserve: 0,
            bondPool: true,
            exists: true
        });
        emit TestnetPoolCreated(token, launchId, creator, true, tokenAmount, msg.value, 0, positionId);
    }

    function createDirectLaunch(
        uint256 launchId,
        address token,
        uint256 tokenAmount,
        address creator,
        bytes32 approvedConfigHash,
        uint256 minimumTokensOut
    ) external payable nonReentrant returns (bytes32 poolId, bytes32 positionId, uint256 creatorTokensOut) {
        if (msg.sender != directFactory) revert NotDirectFactory();
        if (!callersFrozen) revert InvalidConfig();
        if (approvedConfigHash != directConfigHash) revert InvalidConfig();
        if (token == address(0) || creator == address(0) || tokenAmount == 0) revert InvalidAddress();
        if (pools[token].exists) revert PoolAlreadyExists();
        if (IArcTestnetToken(token).balanceOf(address(this)) != tokenAmount) revert InsufficientLiquidity();

        poolId = keccak256(abi.encode("ARC_TESTNET_DIRECT_POOL", block.chainid, launchId, token));
        positionId = keccak256(abi.encode("ARC_TESTNET_DIRECT_POSITION", block.chainid, launchId, token));
        pools[token] = Pool({
            launchId: launchId,
            creator: creator,
            positionId: positionId,
            tokenReserve: tokenAmount,
            realUsdcReserve: 0,
            virtualUsdcReserve: DIRECT_VIRTUAL_USDC_RESERVE,
            bondPool: false,
            exists: true
        });
        emit TestnetPoolCreated(
            token, launchId, creator, false, tokenAmount, 0, DIRECT_VIRTUAL_USDC_RESERVE, positionId
        );
        if (msg.value != 0) creatorTokensOut = _buy(token, creator, msg.value, minimumTokensOut);
    }

    function quoteBuy(address token, uint256 grossUsdcIn) public view returns (uint256 tokensOut, uint256 netUsdcIn) {
        Pool storage pool = pools[token];
        if (!pool.exists) revert InvalidPool();
        if (grossUsdcIn == 0) revert ZeroAmount();
        uint256 platformFee = (grossUsdcIn * feePolicy.buyPlatformFeeBps()) / BPS;
        uint256 creatorFee = (grossUsdcIn * feePolicy.buyCreatorFeeBps()) / BPS;
        netUsdcIn = grossUsdcIn - platformFee - creatorFee;
        uint256 quoteReserve = pool.realUsdcReserve + pool.virtualUsdcReserve;
        uint256 k = pool.tokenReserve * quoteReserve;
        tokensOut = pool.tokenReserve - (k / (quoteReserve + netUsdcIn));
    }

    function quoteSell(address token, uint256 tokenAmount)
        public
        view
        returns (uint256 usdcOut, uint256 grossUsdcOut, uint256 burnAmount)
    {
        Pool storage pool = pools[token];
        if (!pool.exists) revert InvalidPool();
        if (tokenAmount == 0) revert ZeroAmount();
        burnAmount = (tokenAmount * feePolicy.sellBurnFeeBps()) / BPS;
        uint256 netTokenAmount = tokenAmount - burnAmount;
        uint256 quoteReserve = pool.realUsdcReserve + pool.virtualUsdcReserve;
        uint256 k = pool.tokenReserve * quoteReserve;
        grossUsdcOut = quoteReserve - (k / (pool.tokenReserve + netTokenAmount));
        if (grossUsdcOut > pool.realUsdcReserve) revert InsufficientLiquidity();
        uint256 platformFee = (grossUsdcOut * feePolicy.sellPlatformFeeBps()) / BPS;
        usdcOut = grossUsdcOut - platformFee;
    }

    function buy(address token, uint256 minimumTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        return _buy(token, msg.sender, msg.value, minimumTokensOut);
    }

    function sell(address token, uint256 tokenAmount, uint256 minimumUsdcOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        Pool storage pool = pools[token];
        uint256 grossUsdcOut;
        uint256 burnAmount;
        (usdcOut, grossUsdcOut, burnAmount) = quoteSell(token, tokenAmount);
        if (usdcOut < minimumUsdcOut) revert Slippage();

        uint256 netTokenAmount = tokenAmount - burnAmount;
        uint256 platformFee = grossUsdcOut - usdcOut;
        pool.tokenReserve += netTokenAmount;
        pool.realUsdcReserve -= grossUsdcOut;

        if (!IArcTestnetToken(token).transferFrom(msg.sender, address(this), tokenAmount)) {
            revert TokenTransferFailed();
        }
        if (burnAmount != 0 && !IArcTestnetToken(token).transfer(DEAD_WALLET, burnAmount)) {
            revert TokenTransferFailed();
        }
        if (platformFee != 0) revenueRouter.depositTradeRevenue{value: platformFee}();
        (bool ok,) = payable(msg.sender).call{value: usdcOut}("");
        if (!ok) revert UsdcTransferFailed();
        emit TestnetTokensSold(token, msg.sender, tokenAmount, usdcOut, platformFee, burnAmount);
    }

    function claimCreatorUsdc(address payable recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = pendingCreatorUsdc[msg.sender];
        if (amount == 0) revert ZeroAmount();
        pendingCreatorUsdc[msg.sender] = 0;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert UsdcTransferFailed();
        emit CreatorUsdcClaimed(msg.sender, recipient, amount);
    }

    function _buy(address token, address buyer, uint256 grossUsdcIn, uint256 minimumTokensOut)
        private
        returns (uint256 tokensOut)
    {
        Pool storage pool = pools[token];
        uint256 netUsdcIn;
        (tokensOut, netUsdcIn) = quoteBuy(token, grossUsdcIn);
        if (tokensOut == 0 || tokensOut < minimumTokensOut) revert Slippage();
        if (tokensOut >= pool.tokenReserve) revert InsufficientLiquidity();

        uint256 platformFee = (grossUsdcIn * feePolicy.buyPlatformFeeBps()) / BPS;
        uint256 creatorFee = grossUsdcIn - netUsdcIn - platformFee;
        pool.tokenReserve -= tokensOut;
        pool.realUsdcReserve += netUsdcIn;
        pendingCreatorUsdc[pool.creator] += creatorFee;

        if (platformFee != 0) revenueRouter.depositTradeRevenue{value: platformFee}();
        if (!IArcTestnetToken(token).transfer(buyer, tokensOut)) revert TokenTransferFailed();
        emit TestnetTokensBought(token, buyer, grossUsdcIn, tokensOut, platformFee, creatorFee);
    }
}
