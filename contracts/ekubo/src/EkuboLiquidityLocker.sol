// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {IPositions} from "ekubo-v3/src/interfaces/IPositions.sol";
import {createConcentratedPoolConfig} from "ekubo-v3/src/types/poolConfig.sol";
import {PoolId} from "ekubo-v3/src/types/poolId.sol";
import {PoolKey} from "ekubo-v3/src/types/poolKey.sol";
import {ReentrancyGuard} from "../../src/security/ReentrancyGuard.sol";
import {BlueEkuboExtension} from "./BlueEkuboExtension.sol";

interface IERC20EkuboLocker {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

/// @notice Permanently owns Ekubo position NFTs for BlueFun Direct launches.
/// @dev There is intentionally no NFT transfer or principal-withdrawal path.
contract EkuboLiquidityLocker is ReentrancyGuard {
    error NotOwner();
    error NotFactory();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidConfig();
    error InvalidAmount();
    error PositionMintFailed();
    error TokenTransferFailed();

    address public constant DEAD_WALLET = 0x000000000000000000000000000000000000dEaD;

    struct LockedPosition {
        uint256 launchId;
        address token;
        address creator;
        uint256 tokenId;
        uint128 liquidity;
        uint128 tokenAmount;
        PoolId poolId;
        uint64 lockedAt;
    }

    address public immutable owner;
    IPositions public immutable positions;
    BlueEkuboExtension public immutable extension;
    uint32 public immutable tickSpacing;
    int32 public immutable initialTick;
    int32 public immutable tickLower;
    int32 public immutable tickUpper;
    address public factory;

    mapping(bytes32 positionId => LockedPosition position) public lockedPositions;

    event FactoryConfigured(address indexed factory);
    event EkuboLiquidityLocked(
        bytes32 indexed positionId,
        PoolId indexed poolId,
        uint256 indexed launchId,
        address token,
        address creator,
        uint256 tokenAmount,
        uint128 liquidity
    );
    event RoundingResidualBurned(address indexed token, uint256 amount);

    constructor(
        address owner_,
        IPositions positions_,
        BlueEkuboExtension extension_,
        uint32 tickSpacing_,
        int32 initialTick_,
        int32 tickLower_,
        int32 tickUpper_
    ) {
        if (owner_ == address(0) || address(positions_) == address(0) || address(extension_) == address(0)) {
            revert InvalidAddress();
        }
        if (
            tickSpacing_ == 0 || tickLower_ >= tickUpper_ || initialTick_ <= tickUpper_
                || tickLower_ % int32(tickSpacing_) != 0 || tickUpper_ % int32(tickSpacing_) != 0
        ) revert InvalidConfig();
        owner = owner_;
        positions = positions_;
        extension = extension_;
        tickSpacing = tickSpacing_;
        initialTick = initialTick_;
        tickLower = tickLower_;
        tickUpper = tickUpper_;
    }

    function setFactory(address factory_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert AlreadyConfigured();
        if (factory_ == address(0)) revert InvalidAddress();
        factory = factory_;
        emit FactoryConfigured(factory_);
    }

    function poolKey(address token) public view returns (PoolKey memory key) {
        if (token == address(0)) revert InvalidAddress();
        key = PoolKey({
            token0: address(0),
            token1: token,
            config: createConcentratedPoolConfig(0, tickSpacing, address(extension))
        });
    }

    function lockTokenOnlyLiquidity(uint256 launchId, address token, uint256 tokenAmount, address creator)
        external
        nonReentrant
        returns (bytes32 positionId, PoolId poolId)
    {
        if (msg.sender != factory) revert NotFactory();
        if (creator == address(0) || token == address(0)) revert InvalidAddress();
        if (tokenAmount == 0 || tokenAmount > type(uint128).max) revert InvalidAmount();

        PoolKey memory key = poolKey(token);
        poolId = extension.authorizePool(key, creator);
        positions.maybeInitializePool(key, initialTick);

        if (!IERC20EkuboLocker(token).approve(address(positions), 0)) revert TokenTransferFailed();
        if (!IERC20EkuboLocker(token).approve(address(positions), tokenAmount)) revert TokenTransferFailed();
        (uint256 tokenId, uint128 liquidity,, uint128 depositedToken) = positions.mintAndDeposit(
            key, tickLower, tickUpper, 0, uint128(tokenAmount), 0
        );
        if (liquidity == 0 || depositedToken == 0) revert PositionMintFailed();

        uint256 residual = IERC20EkuboLocker(token).balanceOf(address(this));
        if (residual != 0) {
            if (!IERC20EkuboLocker(token).transfer(DEAD_WALLET, residual)) revert TokenTransferFailed();
            emit RoundingResidualBurned(token, residual);
        }

        positionId = bytes32(tokenId);
        lockedPositions[positionId] = LockedPosition({
            launchId: launchId,
            token: token,
            creator: creator,
            tokenId: tokenId,
            liquidity: liquidity,
            tokenAmount: depositedToken,
            poolId: poolId,
            lockedAt: uint64(block.timestamp)
        });
        emit EkuboLiquidityLocked(positionId, poolId, launchId, token, creator, depositedToken, liquidity);
    }
}
