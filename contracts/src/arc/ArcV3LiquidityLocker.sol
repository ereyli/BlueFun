// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StableV3LiquidityLocker} from "../stable/StableV3LiquidityLocker.sol";
import {
    IStableNonfungiblePositionManager,
    IStableUniswapV3Factory
} from "../stable/StableUniswapV3Interfaces.sol";

/// @notice Arc-labelled permanent Uniswap v3 position custody.
/// @dev Inherits the reviewed Stable v3 custody implementation. The configured
///      factory is the Arc adapter and can only be assigned once. There is no
///      NFT approval, transfer, liquidity decrease, burn or rescue path.
contract ArcV3LiquidityLocker is StableV3LiquidityLocker {
    constructor(
        address bootstrapOwner,
        address nativeUsdc,
        address platformFeeRecipient,
        IStableUniswapV3Factory uniswapFactory,
        IStableNonfungiblePositionManager positionManager,
        CurveConfig memory curve
    )
        StableV3LiquidityLocker(
            bootstrapOwner,
            nativeUsdc,
            platformFeeRecipient,
            uniswapFactory,
            positionManager,
            curve
        )
    {}
}
