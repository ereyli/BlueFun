// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {DirectDexLiquidityLocker} from "./DirectDexLiquidityLocker.sol";
import {Ownable} from "./access/Ownable.sol";
import {ReentrancyGuard} from "./security/ReentrancyGuard.sol";

abstract contract DirectLaunchFactoryBase is Ownable, ReentrancyGuard {
    error InvalidLaunchConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee();
    error LaunchFeeClaimFailed();
    error SaltAlreadyUsed();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint24 public constant MAX_POOL_FEE = 50_000; // 5%
    uint256 public constant MAX_LAUNCH_FEE = 0.1 ether;

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    DirectDexLiquidityLocker public immutable liquidityLocker;
    address payable public immutable launchFeeRecipient;
    DirectDexLiquidityLocker.PoolConfig public launchConfig;
    uint256 public launchFee;
    uint256 public launchCount;
    uint256 public pendingLaunchFees;
    mapping(bytes32 salt => bool used) public usedSalts;

    event DirectLaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        bytes32 poolId,
        bytes32 positionId,
        uint24 poolFee,
        int24 tickSpacing,
        uint16 platformShareBps,
        uint16 creatorShareBps,
        string name,
        string symbol,
        string contractURI
    );
    event DirectLaunchConfigUpdated(
        uint24 poolFee,
        int24 tickSpacing,
        int24 tickLower,
        int24 tickUpper,
        uint160 sqrtPriceLowerX96,
        uint160 sqrtPriceUpperX96,
        uint16 platformShareBps,
        uint16 creatorShareBps
    );
    event DirectLaunchFeeUpdated(uint256 launchFee);
    event DirectLaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 amount);
    event DirectLaunchFeesClaimed(address indexed recipient, uint256 amount);

    constructor(
        address initialOwner,
        DirectDexLiquidityLocker liquidityLocker_,
        address payable launchFeeRecipient_,
        DirectDexLiquidityLocker.PoolConfig memory initialConfig,
        uint256 initialLaunchFee
    ) Ownable(initialOwner) {
        if (address(liquidityLocker_) == address(0) || launchFeeRecipient_ == address(0)) {
            revert InvalidLaunchConfig();
        }
        liquidityLocker = liquidityLocker_;
        launchFeeRecipient = launchFeeRecipient_;
        _setLaunchConfig(initialConfig);
        _setLaunchFee(initialLaunchFee);
    }

    function createLaunch(TokenMetadata calldata metadata)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId)
    {
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40 || bytes(metadata.symbol).length == 0
                || bytes(metadata.symbol).length > 10 || bytes(metadata.contractURI).length == 0
        ) revert InvalidMetadata();
        if (usedSalts[metadata.salt]) revert SaltAlreadyUsed();
        if (msg.value != launchFee) revert InsufficientLaunchFee();

        usedSalts[metadata.salt] = true;
        launchId = ++launchCount;
        token = _deployToken(metadata, MAX_SUPPLY, address(liquidityLocker));
        DirectDexLiquidityLocker.PoolConfig memory config = launchConfig;
        (positionId, poolId) = liquidityLocker.lockTokenOnlyLiquidity(launchId, token, MAX_SUPPLY, msg.sender, config);
        pendingLaunchFees += msg.value;

        emit DirectLaunchFeePaid(launchId, msg.sender, msg.value);
        emit DirectLaunchCreated(
            launchId,
            token,
            msg.sender,
            poolId,
            positionId,
            config.poolFee,
            config.tickSpacing,
            config.platformShareBps,
            config.creatorShareBps,
            metadata.name,
            metadata.symbol,
            metadata.contractURI
        );
    }

    function setLaunchConfig(DirectDexLiquidityLocker.PoolConfig calldata newConfig) external onlyOwner {
        _setLaunchConfig(newConfig);
    }

    function setLaunchFee(uint256 newLaunchFee) external onlyOwner {
        _setLaunchFee(newLaunchFee);
    }

    function claimLaunchFees() external onlyOwner returns (uint256 amount) {
        amount = pendingLaunchFees;
        if (amount == 0) revert InsufficientLaunchFee();
        pendingLaunchFees = 0;
        (bool ok,) = launchFeeRecipient.call{value: amount}("");
        if (!ok) revert LaunchFeeClaimFailed();
        emit DirectLaunchFeesClaimed(launchFeeRecipient, amount);
    }

    function _setLaunchConfig(DirectDexLiquidityLocker.PoolConfig memory config) internal {
        if (
            config.poolFee == 0 || config.poolFee > MAX_POOL_FEE || config.tickSpacing <= 0
                || config.tickLower >= config.tickUpper || config.tickLower % config.tickSpacing != 0
                || config.tickUpper % config.tickSpacing != 0 || config.sqrtPriceLowerX96 == 0
                || config.sqrtPriceLowerX96 >= config.sqrtPriceUpperX96
                || config.platformShareBps + config.creatorShareBps != 10_000
        ) revert InvalidLaunchConfig();
        launchConfig = config;
        emit DirectLaunchConfigUpdated(
            config.poolFee,
            config.tickSpacing,
            config.tickLower,
            config.tickUpper,
            config.sqrtPriceLowerX96,
            config.sqrtPriceUpperX96,
            config.platformShareBps,
            config.creatorShareBps
        );
    }

    function _setLaunchFee(uint256 newLaunchFee) internal {
        if (newLaunchFee > MAX_LAUNCH_FEE) revert InvalidLaunchConfig();
        launchFee = newLaunchFee;
        emit DirectLaunchFeeUpdated(newLaunchFee);
    }

    function _deployToken(TokenMetadata calldata metadata, uint256 supply, address liquidityRecipient)
        internal
        virtual
        returns (address token);
}
