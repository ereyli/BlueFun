// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20Minimal} from "../UniswapV4LiquidityLocker.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {
    IStableNonfungiblePositionManager,
    IStableUniswapV3Factory,
    IStableUniswapV3Pool
} from "./StableUniswapV3Interfaces.sol";

/// @notice Mints token-only Uniswap v3 curve positions and permanently locks their NFT principal.
/// @dev There is no decrease-liquidity, burn, approval, or NFT transfer path.
contract StableV3LiquidityLocker is ReentrancyGuard {
    error NotFactory();
    error NotOwner();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidConfig();
    error InvalidPoolState();
    error PositionNotFound();
    error PositionMintFailed();
    error TokenApprovalFailed();
    error TokenTransferFailed();
    error NoFeesCollected();
    error FeeClaimFailed();
    error ExcessTokenResidual();
    error UnexpectedPosition();

    uint16 public constant SHARE_BPS = 10_000;
    uint16 public constant PLATFORM_SHARE_BPS = 7_000;
    uint16 public constant CREATOR_SHARE_BPS = 3_000;
    uint24 public constant POOL_FEE = 10_000; // Uniswap v3 1%
    int24 public constant TICK_SPACING = 200;
    uint256 public constant MAXIMUM_TOKEN_RESIDUAL = 1e12;
    address public constant DEAD_WALLET = 0x000000000000000000000000000000000000dEaD;

    struct CurveConfig {
        int24 canonicalTickLower;
        int24 canonicalTickUpper;
        uint160 canonicalInitialSqrtPriceX96;
    }

    struct LockedPosition {
        uint256 launchId;
        address token;
        address creator;
        address pool;
        uint256 tokenId;
        uint128 liquidity;
        uint256 tokenAmountLocked;
        int24 tickLower;
        int24 tickUpper;
        uint64 lockedAt;
    }

    struct FeeRevenue {
        uint256 quoteCollected;
        uint256 tokenCollected;
        uint256 platformQuote;
        uint256 platformToken;
        uint256 creatorQuote;
        uint256 tokenBurned;
    }

    address public immutable owner;
    address public immutable quoteToken;
    address public immutable platformFeeRecipient;
    IStableUniswapV3Factory public immutable uniswapFactory;
    IStableNonfungiblePositionManager public immutable positionManager;
    int24 public immutable canonicalTickLower;
    int24 public immutable canonicalTickUpper;
    uint160 public immutable canonicalInitialSqrtPriceX96;
    bytes32 public immutable configHash;
    address public factory;

    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;
    mapping(bytes32 positionId => FeeRevenue revenue) public feeRevenue;
    mapping(address account => mapping(address currency => uint256 amount)) public pendingFees;

    event FactoryConfigured(address indexed factory);
    event DirectLiquidityLocked(
        bytes32 indexed positionId,
        bytes32 indexed poolId,
        uint256 indexed launchId,
        address token,
        address creator,
        address pool,
        uint256 tokenAmount,
        uint24 poolFee
    );
    event PositionFeesCollected(
        bytes32 indexed positionId,
        address indexed token,
        address indexed creator,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 platformQuote,
        uint256 platformToken,
        uint256 creatorQuote,
        uint256 tokenBurned
    );
    event FeesClaimed(address indexed account, address indexed currency, uint256 amount);
    event PlatformFeesSwept(address indexed recipient, address indexed currency, uint256 amount);
    event SellTokenFeesBurned(bytes32 indexed positionId, address indexed token, uint256 amount);

    constructor(
        address owner_,
        address quoteToken_,
        address platformFeeRecipient_,
        IStableUniswapV3Factory uniswapFactory_,
        IStableNonfungiblePositionManager positionManager_,
        CurveConfig memory curve
    ) {
        if (
            owner_ == address(0) || quoteToken_ == address(0) || platformFeeRecipient_ == address(0)
                || address(uniswapFactory_) == address(0) || address(positionManager_) == address(0)
        ) revert InvalidAddress();
        if (
            curve.canonicalTickLower >= curve.canonicalTickUpper
                || curve.canonicalTickLower % TICK_SPACING != 0
                || curve.canonicalTickUpper % TICK_SPACING != 0
                || curve.canonicalInitialSqrtPriceX96 == 0
        ) revert InvalidConfig();
        owner = owner_;
        quoteToken = quoteToken_;
        platformFeeRecipient = platformFeeRecipient_;
        uniswapFactory = uniswapFactory_;
        positionManager = positionManager_;
        canonicalTickLower = curve.canonicalTickLower;
        canonicalTickUpper = curve.canonicalTickUpper;
        canonicalInitialSqrtPriceX96 = curve.canonicalInitialSqrtPriceX96;
        configHash = keccak256(
            abi.encode(
                quoteToken_,
                address(uniswapFactory_),
                address(positionManager_),
                POOL_FEE,
                TICK_SPACING,
                curve,
                PLATFORM_SHARE_BPS,
                CREATOR_SHARE_BPS
            )
        );
    }

    function setFactory(address factory_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert AlreadyConfigured();
        if (factory_ == address(0)) revert InvalidAddress();
        factory = factory_;
        emit FactoryConfigured(factory_);
    }

    function lockTokenOnlyLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        nonReentrant
        returns (bytes32 positionId, bytes32 poolId, address pool)
    {
        if (msg.sender != factory) revert NotFactory();
        if (token == address(0) || token == quoteToken || creator == address(0) || tokenAmount == 0) {
            revert InvalidAddress();
        }

        bool quoteIsToken0 = quoteToken < token;
        address token0 = quoteIsToken0 ? quoteToken : token;
        address token1 = quoteIsToken0 ? token : quoteToken;
        int24 tickLower = quoteIsToken0 ? canonicalTickLower : -canonicalTickUpper;
        int24 tickUpper = quoteIsToken0 ? canonicalTickUpper : -canonicalTickLower;
        uint160 initialSqrtPriceX96 =
            quoteIsToken0 ? canonicalInitialSqrtPriceX96 : _invertSqrtPrice(canonicalInitialSqrtPriceX96);

        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, initialSqrtPriceX96);
        if (pool == address(0) || uniswapFactory.getPool(token0, token1, POOL_FEE) != pool) {
            revert InvalidPoolState();
        }
        (uint160 currentSqrtPriceX96,,,,,,) = IStableUniswapV3Pool(pool).slot0();
        if (currentSqrtPriceX96 != initialSqrtPriceX96) revert InvalidPoolState();

        if (!IERC20Minimal(token).approve(address(positionManager), tokenAmount)) revert TokenApprovalFailed();
        IStableNonfungiblePositionManager.MintParams memory params = IStableNonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            fee: POOL_FEE,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: quoteIsToken0 ? 0 : tokenAmount,
            amount1Desired: quoteIsToken0 ? tokenAmount : 0,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp + 30 minutes
        });
        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) = positionManager.mint(params);
        if (!IERC20Minimal(token).approve(address(positionManager), 0)) revert TokenApprovalFailed();
        if (tokenId == 0 || liquidity == 0) revert PositionMintFailed();

        uint256 tokenUsed = quoteIsToken0 ? amount1 : amount0;
        if (tokenUsed == 0 || tokenUsed > tokenAmount) revert PositionMintFailed();
        uint256 residual = tokenAmount - tokenUsed;
        if (residual > MAXIMUM_TOKEN_RESIDUAL) revert ExcessTokenResidual();
        if (residual != 0 && !IERC20Minimal(token).transfer(DEAD_WALLET, residual)) revert TokenTransferFailed();

        (,, address positionToken0, address positionToken1, uint24 fee, int24 lower, int24 upper, uint128 storedLiquidity,,,,) =
            positionManager.positions(tokenId);
        if (
            positionToken0 != token0 || positionToken1 != token1 || fee != POOL_FEE || lower != tickLower
                || upper != tickUpper || storedLiquidity != liquidity
        ) revert UnexpectedPosition();

        positionId = bytes32(tokenId);
        poolId = bytes32(uint256(uint160(pool)));
        lockedPositions[positionId] = LockedPosition({
            launchId: launchId,
            token: token,
            creator: creator,
            pool: pool,
            tokenId: tokenId,
            liquidity: liquidity,
            tokenAmountLocked: tokenUsed,
            tickLower: tickLower,
            tickUpper: tickUpper,
            lockedAt: uint64(block.timestamp)
        });
        emit DirectLiquidityLocked(
            positionId, poolId, launchId, token, creator, pool, tokenUsed, POOL_FEE
        );
    }

    function collectFees(bytes32 positionId)
        external
        nonReentrant
        returns (uint256 quoteAmount, uint256 tokenAmount)
    {
        LockedPosition storage position = lockedPositions[positionId];
        if (position.token == address(0)) revert PositionNotFound();

        uint256 quoteBefore = IERC20Minimal(quoteToken).balanceOf(address(this));
        uint256 tokenBefore = IERC20Minimal(position.token).balanceOf(address(this));
        bool quoteIsToken0 = quoteToken < position.token;
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            IStableNonfungiblePositionManager.CollectParams({
                tokenId: position.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        quoteAmount = IERC20Minimal(quoteToken).balanceOf(address(this)) - quoteBefore;
        tokenAmount = IERC20Minimal(position.token).balanceOf(address(this)) - tokenBefore;
        if (
            quoteAmount != (quoteIsToken0 ? amount0 : amount1)
                || tokenAmount != (quoteIsToken0 ? amount1 : amount0)
        ) revert UnexpectedPosition();
        if (quoteAmount == 0 && tokenAmount == 0) revert NoFeesCollected();

        uint256 platformQuote = (quoteAmount * PLATFORM_SHARE_BPS) / SHARE_BPS;
        uint256 creatorQuote = quoteAmount - platformQuote;
        uint256 platformToken = (tokenAmount * PLATFORM_SHARE_BPS) / SHARE_BPS;
        uint256 tokenBurned = tokenAmount - platformToken;

        pendingFees[platformFeeRecipient][quoteToken] += platformQuote;
        pendingFees[position.creator][quoteToken] += creatorQuote;
        pendingFees[platformFeeRecipient][position.token] += platformToken;
        if (tokenBurned != 0) {
            if (!IERC20Minimal(position.token).transfer(DEAD_WALLET, tokenBurned)) revert TokenTransferFailed();
            emit SellTokenFeesBurned(positionId, position.token, tokenBurned);
        }

        FeeRevenue storage revenue = feeRevenue[positionId];
        revenue.quoteCollected += quoteAmount;
        revenue.tokenCollected += tokenAmount;
        revenue.platformQuote += platformQuote;
        revenue.platformToken += platformToken;
        revenue.creatorQuote += creatorQuote;
        revenue.tokenBurned += tokenBurned;

        emit PositionFeesCollected(
            positionId,
            position.token,
            position.creator,
            quoteAmount,
            tokenAmount,
            platformQuote,
            platformToken,
            creatorQuote,
            tokenBurned
        );
    }

    function claimFees(address currency) external nonReentrant returns (uint256 amount) {
        if (msg.sender == platformFeeRecipient) revert FeeClaimFailed();
        amount = _takePending(msg.sender, currency);
        _transferToken(currency, msg.sender, amount);
        emit FeesClaimed(msg.sender, currency, amount);
    }

    function sweepPlatformFees(address currency) external nonReentrant returns (uint256 amount) {
        amount = _takePending(platformFeeRecipient, currency);
        _transferToken(currency, platformFeeRecipient, amount);
        emit PlatformFeesSwept(platformFeeRecipient, currency, amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert UnexpectedPosition();
        return this.onERC721Received.selector;
    }

    function _takePending(address account, address currency) private returns (uint256 amount) {
        amount = pendingFees[account][currency];
        if (amount == 0) revert NoFeesCollected();
        pendingFees[account][currency] = 0;
    }

    function _transferToken(address currency, address recipient, uint256 amount) private {
        if (currency == address(0) || recipient == address(0)) revert InvalidAddress();
        if (!IERC20Minimal(currency).transfer(recipient, amount)) revert TokenTransferFailed();
    }

    function _invertSqrtPrice(uint160 sqrtPriceX96) private pure returns (uint160 inverted) {
        uint256 value = (uint256(1) << 192) / uint256(sqrtPriceX96);
        if (value == 0 || value > type(uint160).max) revert InvalidConfig();
        inverted = uint160(value);
    }
}
