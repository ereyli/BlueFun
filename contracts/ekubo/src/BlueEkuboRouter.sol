// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {BaseRouter} from "ekubo-v3/src/base/BaseRouter.sol";
import {ICore} from "ekubo-v3/src/interfaces/ICore.sol";
import {CoreLib} from "ekubo-v3/src/libraries/CoreLib.sol";
import {createConcentratedPoolConfig} from "ekubo-v3/src/types/poolConfig.sol";
import {PoolBalanceUpdate} from "ekubo-v3/src/types/poolBalanceUpdate.sol";
import {PoolKey} from "ekubo-v3/src/types/poolKey.sol";
import {PoolState} from "ekubo-v3/src/types/poolState.sol";
import {SqrtRatio} from "ekubo-v3/src/types/sqrtRatio.sol";
import {SwapParameters} from "ekubo-v3/src/types/swapParameters.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {ReentrancyGuard} from "../../src/security/ReentrancyGuard.sol";
import {BlueEkuboExtension} from "./BlueEkuboExtension.sol";

interface IERC20EkuboRouter {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice The only executable swap route for BlueFun Ekubo pools.
/// @dev Generic BaseRouter entry points are inherited for ABI compatibility, but `_swap` rejects them unless one of the
///      fee-aware methods below has opened the operation gate. The pool extension also rejects every other locker.
contract BlueEkuboRouter is BaseRouter, ReentrancyGuard {
    using CoreLib for ICore;
    error InvalidAddress();
    error InvalidAmount();
    error InvalidPool();
    error UnauthorizedOperation();
    error SlippageExceeded();
    error TokenTransferFailed();
    error NativeTransferFailed();
    error NoCreatorRevenue();

    uint16 public constant BPS = 10_000;
    address public constant DEAD_WALLET = 0x000000000000000000000000000000000000dEaD;

    IFeePolicy public immutable policy;
    IRevenueRouter public immutable revenueRouter;
    BlueEkuboExtension public immutable extension;
    uint32 public immutable tickSpacing;

    bool private operationActive;
    mapping(address creator => uint256 amount) public pendingCreatorRevenue;

    event EkuboBuy(
        address indexed token,
        address indexed buyer,
        address indexed recipient,
        uint256 grossNativeIn,
        uint256 tokenOut,
        uint256 platformFee,
        uint256 creatorFee
    );
    event EkuboSell(
        address indexed token,
        address indexed seller,
        address indexed recipient,
        uint256 grossTokenIn,
        uint256 nativeOut,
        uint256 platformFee,
        uint256 tokenBurned
    );
    event CreatorRevenueClaimed(address indexed creator, address indexed recipient, uint256 amount);

    constructor(
        ICore core,
        IFeePolicy policy_,
        IRevenueRouter revenueRouter_,
        BlueEkuboExtension extension_,
        uint32 tickSpacing_
    ) BaseRouter(core) {
        if (
            address(policy_) == address(0) || address(revenueRouter_) == address(0)
                || address(extension_) == address(0) || tickSpacing_ == 0
        ) revert InvalidAddress();
        policy = policy_;
        revenueRouter = revenueRouter_;
        extension = extension_;
        tickSpacing = tickSpacing_;
    }

    receive() external payable {}

    function poolKey(address token) public view returns (PoolKey memory key) {
        if (token == address(0)) revert InvalidPool();
        key = PoolKey({
            token0: address(0),
            token1: token,
            // BlueFun applies its 1% economics in this router. A zero Ekubo LP fee avoids charging users twice.
            config: createConcentratedPoolConfig(0, tickSpacing, address(extension))
        });
    }

    function buy(address token, uint128 minimumTokensOut, address recipient)
        external
        payable
        nonReentrant
        returns (uint128 tokensOut)
    {
        if (msg.value == 0 || recipient == address(0)) revert InvalidAmount();
        PoolKey memory key = poolKey(token);
        address creator = extension.creatorForPool(key);
        if (creator == address(0)) revert InvalidPool();

        uint256 platformFee = (msg.value * policy.buyPlatformFeeBps()) / BPS;
        uint256 creatorFee = (msg.value * policy.buyCreatorFeeBps()) / BPS;
        uint256 amountIn = msg.value - platformFee - creatorFee;
        if (amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) revert InvalidAmount();

        if (platformFee != 0) revenueRouter.depositTradeRevenue{value: platformFee}();
        pendingCreatorRevenue[creator] += creatorFee;

        operationActive = true;
        PoolBalanceUpdate update = this.swap{value: amountIn}(
            key,
            false,
            int128(uint128(amountIn)),
            SqrtRatio.wrap(0),
            0,
            int256(uint256(minimumTokensOut)),
            recipient
        );
        operationActive = false;

        int128 tokenDelta = update.delta1();
        if (tokenDelta >= 0) revert InvalidPool();
        tokensOut = uint128(-tokenDelta);
        if (tokensOut < minimumTokensOut) revert SlippageExceeded();
        emit EkuboBuy(token, msg.sender, recipient, msg.value, tokensOut, platformFee, creatorFee);
    }

    function sell(address token, uint128 grossTokenIn, uint128 minimumNativeOut, address payable recipient)
        external
        nonReentrant
        returns (uint128 nativeOut)
    {
        if (grossTokenIn == 0 || recipient == address(0)) revert InvalidAmount();
        PoolKey memory key = poolKey(token);
        if (extension.creatorForPool(key) == address(0)) revert InvalidPool();

        _safeTransferFrom(token, msg.sender, address(this), grossTokenIn);
        uint256 tokenBurned = (uint256(grossTokenIn) * policy.sellBurnFeeBps()) / BPS;
        uint256 amountIn = uint256(grossTokenIn) - tokenBurned;
        if (amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) revert InvalidAmount();
        if (tokenBurned != 0) _safeTransfer(token, DEAD_WALLET, tokenBurned);
        // BaseRouter's settlement library executes transferFrom from this router and
        // sends the payment to Core. The spender is therefore the router itself.
        _forceApprove(token, address(this), type(uint256).max);

        operationActive = true;
        PoolBalanceUpdate update = this.swap(
            key,
            true,
            int128(uint128(amountIn)),
            SqrtRatio.wrap(0),
            0,
            0,
            address(this)
        );
        operationActive = false;
        _forceApprove(token, address(this), 0);

        int128 nativeDelta = update.delta0();
        if (nativeDelta >= 0) revert InvalidPool();
        uint256 grossNativeOut = uint128(-nativeDelta);
        uint256 platformFee = (grossNativeOut * policy.sellPlatformFeeBps()) / BPS;
        uint256 userAmount = grossNativeOut - platformFee;
        if (userAmount < minimumNativeOut || userAmount > type(uint128).max) revert SlippageExceeded();
        nativeOut = uint128(userAmount);

        if (platformFee != 0) revenueRouter.depositTradeRevenue{value: platformFee}();
        _sendNative(recipient, userAmount);
        emit EkuboSell(token, msg.sender, recipient, grossTokenIn, userAmount, platformFee, tokenBurned);
    }

    function quoteBuy(address token, uint128 grossNativeIn) external returns (uint128 tokensOut) {
        if (grossNativeIn == 0) return 0;
        uint256 amountIn = uint256(grossNativeIn)
            - (uint256(grossNativeIn) * policy.buyPlatformFeeBps()) / BPS
            - (uint256(grossNativeIn) * policy.buyCreatorFeeBps()) / BPS;
        if (amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) revert InvalidAmount();
        operationActive = true;
        (PoolBalanceUpdate update,) = this.quote(
            poolKey(token), false, int128(uint128(amountIn)), SqrtRatio.wrap(0), 0
        );
        operationActive = false;
        int128 delta = update.delta1();
        if (delta >= 0) revert InvalidPool();
        tokensOut = uint128(-delta);
    }

    function quoteSell(address token, uint128 grossTokenIn) external returns (uint128 nativeOut) {
        if (grossTokenIn == 0) return 0;
        uint256 amountIn = uint256(grossTokenIn)
            - (uint256(grossTokenIn) * policy.sellBurnFeeBps()) / BPS;
        if (amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) revert InvalidAmount();
        operationActive = true;
        (PoolBalanceUpdate update,) = this.quote(
            poolKey(token), true, int128(uint128(amountIn)), SqrtRatio.wrap(0), 0
        );
        operationActive = false;
        int128 delta = update.delta0();
        if (delta >= 0) revert InvalidPool();
        uint256 grossNativeOut = uint128(-delta);
        uint256 result = grossNativeOut - (grossNativeOut * policy.sellPlatformFeeBps()) / BPS;
        if (result > type(uint128).max) revert InvalidAmount();
        nativeOut = uint128(result);
    }

    function claimCreatorRevenue(address payable recipient) external nonReentrant returns (uint256 amount) {
        if (recipient == address(0)) revert InvalidAddress();
        amount = pendingCreatorRevenue[msg.sender];
        if (amount == 0) revert NoCreatorRevenue();
        pendingCreatorRevenue[msg.sender] = 0;
        _sendNative(recipient, amount);
        emit CreatorRevenueClaimed(msg.sender, recipient, amount);
    }

    function _swap(uint256 value, PoolKey memory key, SwapParameters params)
        internal
        override
        returns (PoolBalanceUpdate balanceUpdate, PoolState stateAfter)
    {
        if (!operationActive) revert UnauthorizedOperation();
        return CORE.swap(value, key, params.withDefaultSqrtRatioLimit());
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        if (!IERC20EkuboRouter(token).transfer(to, amount)) revert TokenTransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        if (!IERC20EkuboRouter(token).transferFrom(from, to, amount)) revert TokenTransferFailed();
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        if (!IERC20EkuboRouter(token).approve(spender, 0)) revert TokenTransferFailed();
        if (!IERC20EkuboRouter(token).approve(spender, amount)) revert TokenTransferFailed();
    }

    function _sendNative(address payable recipient, uint256 amount) private {
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }
}
