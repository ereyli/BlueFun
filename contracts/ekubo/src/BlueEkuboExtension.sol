// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {BaseExtension} from "ekubo-v3/src/base/BaseExtension.sol";
import {ICore, IExtension} from "ekubo-v3/src/interfaces/ICore.sol";
import {CallPoints} from "ekubo-v3/src/types/callPoints.sol";
import {Locker} from "ekubo-v3/src/types/locker.sol";
import {PoolKey} from "ekubo-v3/src/types/poolKey.sol";
import {PoolId} from "ekubo-v3/src/types/poolId.sol";
import {PositionId} from "ekubo-v3/src/types/positionId.sol";
import {PoolBalanceUpdate} from "ekubo-v3/src/types/poolBalanceUpdate.sol";
import {PoolState} from "ekubo-v3/src/types/poolState.sol";
import {SqrtRatio} from "ekubo-v3/src/types/sqrtRatio.sol";
import {SwapParameters} from "ekubo-v3/src/types/swapParameters.sol";

/// @notice Immutable swap gate for BlueFun Ekubo pools.
/// @dev Ekubo encodes extension call points in the most-significant byte of the extension address. This contract must
///      be CREATE2-deployed at an address whose first byte is 0x41 (beforeInitializePool + beforeSwap).
contract BlueEkuboExtension is BaseExtension {
    error NotOwner();
    error NotLocker();
    error AlreadyConfigured();
    error InvalidAddress();
    error InvalidPool();
    error UnauthorizedInitialization();
    error UnauthorizedRouter();

    address public immutable owner;
    address public feeRouter;
    address public liquidityLocker;
    address public poolInitializer;
    bool public configured;

    mapping(PoolId poolId => address creator) public poolCreator;

    event Configured(address indexed feeRouter, address indexed liquidityLocker, address indexed poolInitializer);
    event PoolAuthorized(PoolId indexed poolId, address indexed token, address indexed creator);

    constructor(ICore core, address owner_) BaseExtension(core) {
        if (owner_ == address(0)) revert InvalidAddress();
        owner = owner_;
    }

    function configure(address feeRouter_, address liquidityLocker_, address poolInitializer_) external {
        if (msg.sender != owner) revert NotOwner();
        if (configured) revert AlreadyConfigured();
        if (feeRouter_ == address(0) || liquidityLocker_ == address(0) || poolInitializer_ == address(0)) {
            revert InvalidAddress();
        }
        configured = true;
        feeRouter = feeRouter_;
        liquidityLocker = liquidityLocker_;
        poolInitializer = poolInitializer_;
        emit Configured(feeRouter_, liquidityLocker_, poolInitializer_);
    }

    function authorizePool(PoolKey calldata poolKey, address creator) external returns (PoolId poolId) {
        if (msg.sender != liquidityLocker) revert NotLocker();
        if (creator == address(0) || poolKey.token0 != address(0) || poolKey.token1 == address(0)) {
            revert InvalidPool();
        }
        poolId = poolKey.toPoolId();
        if (poolCreator[poolId] != address(0)) revert InvalidPool();
        poolCreator[poolId] = creator;
        emit PoolAuthorized(poolId, poolKey.token1, creator);
    }

    function creatorForPool(PoolKey calldata poolKey) external view returns (address) {
        return poolCreator[poolKey.toPoolId()];
    }

    function getCallPoints() internal pure override returns (CallPoints memory) {
        return CallPoints({
            beforeInitializePool: true,
            afterInitializePool: false,
            beforeSwap: true,
            afterSwap: false,
            beforeUpdatePosition: false,
            afterUpdatePosition: false,
            beforeCollectFees: false,
            afterCollectFees: false
        });
    }

    function beforeInitializePool(address caller, PoolKey calldata poolKey, int32)
        external
        override(BaseExtension)
        onlyCore
    {
        if (caller != poolInitializer || poolCreator[poolKey.toPoolId()] == address(0)) {
            revert UnauthorizedInitialization();
        }
    }

    function beforeSwap(Locker locker, PoolKey memory poolKey, SwapParameters)
        external
        override(BaseExtension)
        onlyCore
    {
        if (poolCreator[poolKey.toPoolId()] == address(0)) revert InvalidPool();
        if (locker.addr() != feeRouter) revert UnauthorizedRouter();
    }

    function afterInitializePool(address, PoolKey calldata, int32, SqrtRatio)
        external
        pure
        override(BaseExtension)
    {
        revert CallPointNotImplemented();
    }

    function beforeUpdatePosition(Locker, PoolKey memory, PositionId, int128)
        external
        pure
        override(BaseExtension)
    {
        revert CallPointNotImplemented();
    }

    function afterUpdatePosition(Locker, PoolKey memory, PositionId, int128, PoolBalanceUpdate, PoolState)
        external
        pure
        override(BaseExtension)
    {
        revert CallPointNotImplemented();
    }

    function afterSwap(Locker, PoolKey memory, SwapParameters, PoolBalanceUpdate, PoolState)
        external
        pure
        override(BaseExtension)
    {
        revert CallPointNotImplemented();
    }

    function beforeCollectFees(Locker, PoolKey memory, PositionId)
        external
        pure
        override(BaseExtension)
    {
        revert CallPointNotImplemented();
    }

    function afterCollectFees(Locker, PoolKey memory, PositionId, uint128, uint128)
        external
        pure
        override(BaseExtension)
    {
        revert CallPointNotImplemented();
    }
}
