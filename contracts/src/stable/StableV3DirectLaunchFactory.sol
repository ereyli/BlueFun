// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StandardLaunchToken} from "../StandardLaunchToken.sol";
import {IERC20Minimal} from "../UniswapV4LiquidityLocker.sol";
import {Ownable} from "../access/Ownable.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";
import {StableV3LiquidityLocker} from "./StableV3LiquidityLocker.sol";
import {IStableSwapRouter02} from "./StableUniswapV3Interfaces.sol";

interface IStableUSDT0 is IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @notice Stable Direct factory using the canonical Uniswap v3 deployment and native/ERC-20 USDT0.
contract StableV3DirectLaunchFactory is Ownable, ReentrancyGuard {
    error InvalidLaunchConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee();
    error SaltAlreadyUsed();
    error DeadlineExpired();
    error LaunchConfigChanged();
    error LaunchesPaused();
    error InitialBuyFailed();
    error InitialBuyExceedsFivePercent();
    error InvalidUSDT0Precision();
    error TokenApprovalFailed();
    error TokenTransferFailed();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_INITIAL_BUY_TOKENS = MAX_SUPPLY / 20;
    uint256 public constant NATIVE_TO_ERC20_SCALE = 1e12;

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    struct LaunchRecord {
        address token;
        address creator;
        address pool;
        bytes32 positionId;
    }

    StableV3LiquidityLocker public immutable liquidityLocker;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    IStableUSDT0 public immutable usdt0;
    IStableSwapRouter02 public immutable swapRouter;
    uint256 public launchCount;
    mapping(bytes32 effectiveSalt => bool used) public usedSalts;
    mapping(uint256 launchId => LaunchRecord launch) public launches;

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
    event StableDirectPoolResolved(uint256 indexed launchId, address indexed token, address indexed pool);
    event DirectLaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 amount);
    event CreatorInitialBuy(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 nativeAmount,
        uint256 erc20Amount,
        uint256 tokenAmount
    );

    constructor(
        address initialOwner,
        StableV3LiquidityLocker liquidityLocker_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_,
        IStableUSDT0 usdt0_,
        IStableSwapRouter02 swapRouter_
    ) Ownable(initialOwner) {
        if (
            address(liquidityLocker_) == address(0) || address(feePolicy_) == address(0)
                || address(revenueRouter_) == address(0) || address(usdt0_) == address(0)
                || address(swapRouter_) == address(0)
        ) revert InvalidLaunchConfig();
        liquidityLocker = liquidityLocker_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
        usdt0 = usdt0_;
        swapRouter = swapRouter_;
    }

    function launchFee() external view returns (uint256) {
        return feePolicy.launchFee();
    }

    function launchConfigHash() public view returns (bytes32) {
        return liquidityLocker.configHash();
    }

    /// @notice Compatibility view consumed by the existing BlueFun Direct launch UI.
    function launchConfig()
        external
        view
        returns (
            uint24 poolFee,
            int24 tickSpacing,
            int24 tickLower,
            int24 tickUpper,
            uint160 initialSqrtPriceX96,
            uint16 platformShareBps,
            uint16 creatorShareBps
        )
    {
        return (
            liquidityLocker.POOL_FEE(),
            liquidityLocker.TICK_SPACING(),
            liquidityLocker.canonicalTickLower(),
            liquidityLocker.canonicalTickUpper(),
            liquidityLocker.canonicalInitialSqrtPriceX96(),
            liquidityLocker.PLATFORM_SHARE_BPS(),
            liquidityLocker.CREATOR_SHARE_BPS()
        );
    }

    function predictTokenAddress(address creator, TokenMetadata calldata metadata) external view returns (address) {
        bytes32 effectiveSalt = keccak256(abi.encode(creator, block.chainid, metadata.salt));
        bytes memory init = abi.encodePacked(
            type(StandardLaunchToken).creationCode,
            abi.encode(metadata.name, metadata.symbol, metadata.contractURI, address(liquidityLocker), MAX_SUPPLY)
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), effectiveSalt, keccak256(init)))))
        );
    }

    function createLaunch(TokenMetadata calldata metadata, bytes32 expectedConfigHash, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId)
    {
        return _createLaunch(metadata, expectedConfigHash, deadline, 0, 0);
    }

    function createLaunchWithInitialBuy(
        TokenMetadata calldata metadata,
        bytes32 expectedConfigHash,
        uint256 deadline,
        uint256 initialBuyUSDT0,
        uint256 minimumTokensOut
    ) external payable nonReentrant returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (initialBuyUSDT0 == 0) revert InitialBuyFailed();
        return _createLaunch(metadata, expectedConfigHash, deadline, initialBuyUSDT0, minimumTokensOut);
    }

    function _createLaunch(
        TokenMetadata calldata metadata,
        bytes32 expectedConfigHash,
        uint256 deadline,
        uint256 initialBuyUSDT0,
        uint256 minimumTokensOut
    ) private returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (expectedConfigHash != launchConfigHash()) revert LaunchConfigChanged();
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40
                || bytes(metadata.symbol).length == 0 || bytes(metadata.symbol).length > 10
                || bytes(metadata.contractURI).length == 0 || bytes(metadata.contractURI).length > 512
        ) revert InvalidMetadata();

        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value != currentLaunchFee) revert InsufficientLaunchFee();
        if (currentLaunchFee % NATIVE_TO_ERC20_SCALE != 0) revert InvalidUSDT0Precision();

        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, metadata.salt));
        if (usedSalts[effectiveSalt]) revert SaltAlreadyUsed();
        usedSalts[effectiveSalt] = true;
        launchId = ++launchCount;
        token = address(
            new StandardLaunchToken{salt: effectiveSalt}(
                metadata.name, metadata.symbol, metadata.contractURI, address(liquidityLocker), MAX_SUPPLY
            )
        );
        address pool;
        (positionId, poolId, pool) =
            liquidityLocker.lockTokenOnlyLiquidity(launchId, token, MAX_SUPPLY, msg.sender);

        if (currentLaunchFee != 0) revenueRouter.depositLaunchRevenue{value: currentLaunchFee}();
        if (initialBuyUSDT0 != 0) {
            uint256 bought = _executeInitialBuy(token, initialBuyUSDT0, minimumTokensOut);
            if (bought == 0) revert InitialBuyFailed();
            if (bought > MAX_INITIAL_BUY_TOKENS) revert InitialBuyExceedsFivePercent();
            emit CreatorInitialBuy(
                launchId,
                token,
                msg.sender,
                initialBuyUSDT0 * NATIVE_TO_ERC20_SCALE,
                initialBuyUSDT0,
                bought
            );
        } else if (minimumTokensOut != 0) {
            revert InitialBuyFailed();
        }

        launches[launchId] = LaunchRecord(token, msg.sender, pool, positionId);
        emit DirectLaunchFeePaid(launchId, msg.sender, currentLaunchFee);
        emit DirectLaunchCreated(
            launchId,
            token,
            msg.sender,
            poolId,
            positionId,
            liquidityLocker.POOL_FEE(),
            liquidityLocker.TICK_SPACING(),
            liquidityLocker.PLATFORM_SHARE_BPS(),
            liquidityLocker.CREATOR_SHARE_BPS(),
            metadata.name,
            metadata.symbol,
            metadata.contractURI
        );
        emit StableDirectPoolResolved(launchId, token, pool);
    }

    function _executeInitialBuy(address token, uint256 erc20Amount, uint256 minimumTokensOut)
        private
        returns (uint256 bought)
    {
        if (!usdt0.transferFrom(msg.sender, address(this), erc20Amount)) revert TokenTransferFailed();
        if (!usdt0.approve(address(swapRouter), erc20Amount)) revert TokenApprovalFailed();
        bought = swapRouter.exactInputSingle(
            IStableSwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdt0),
                tokenOut: token,
                fee: liquidityLocker.POOL_FEE(),
                recipient: msg.sender,
                amountIn: erc20Amount,
                amountOutMinimum: minimumTokensOut,
                sqrtPriceLimitX96: 0
            })
        );
        if (!usdt0.approve(address(swapRouter), 0)) revert TokenApprovalFailed();
    }
}
