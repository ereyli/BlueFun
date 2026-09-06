// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StockDirectLaunchFactoryBase} from "./StockDirectLaunchFactoryBase.sol";
import {StockQuoteRegistry} from "./StockQuoteRegistry.sol";
import {StockLiquidityLocker} from "./StockLiquidityLocker.sol";
import {IB20} from "../interfaces/IB20.sol";
import {IB20Factory} from "../interfaces/IB20Factory.sol";
import {IActivationRegistry} from "../interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../libraries/B20Constants.sol";
import {PolicyGuard} from "../PolicyGuard.sol";
import {IPermit2AllowanceTransfer} from "../UniswapV4LiquidityLocker.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";

contract StockDirectB20LaunchFactory is StockDirectLaunchFactoryBase, PolicyGuard {
    error B20AssetNotActivated();

    IB20Factory public immutable b20Factory;
    IActivationRegistry public immutable activationRegistry;

    constructor(
        address initialOwner,
        IB20Factory b20Factory_,
        IActivationRegistry activationRegistry_,
        IPolicyRegistry policyRegistry_,
        StockLiquidityLocker locker,
        StockQuoteRegistry registry,
        IFeePolicy policy,
        IRevenueRouter revenueRouter,
        IPermit2AllowanceTransfer permit2,
        LaunchConfig memory initialConfig
    )
        StockDirectLaunchFactoryBase(initialOwner, locker, registry, policy, revenueRouter, permit2, initialConfig)
        PolicyGuard(policyRegistry_)
    {
        if (address(b20Factory_) == address(0) || address(activationRegistry_) == address(0)) {
            revert InvalidLaunchConfig();
        }
        b20Factory = b20Factory_;
        activationRegistry = activationRegistry_;
    }

    function predictTokenAddress(address creator, address quoteToken, TokenMetadata calldata metadata)
        external
        view
        returns (address)
    {
        bytes32 salt = keccak256(abi.encode(creator, block.chainid, quoteToken, metadata.salt));
        return b20Factory.getB20Address(IB20Factory.B20Variant.ASSET, address(this), salt);
    }

    function _deployToken(TokenMetadata calldata metadata, bytes32 salt, uint256 supply, address recipient)
        internal
        override
        returns (address token)
    {
        if (!activationRegistry.isActivated(B20Constants.B20_ASSET_FEATURE)) revert B20AssetNotActivated();
        bytes[] memory initCalls = new bytes[](5);
        IB20Factory.B20AssetCreateParams memory params = IB20Factory.B20AssetCreateParams({
            version: 1, name: metadata.name, symbol: metadata.symbol, initialAdmin: address(this), decimals: 18
        });
        bytes32 mintRole = keccak256("MINT_ROLE");
        initCalls[0] = abi.encodeCall(IB20.updateSupplyCap, (supply));
        initCalls[1] = abi.encodeCall(IB20.updateContractURI, (metadata.contractURI));
        initCalls[2] = abi.encodeCall(IB20.grantRole, (mintRole, address(b20Factory)));
        initCalls[3] = abi.encodeCall(IB20.mint, (recipient, supply));
        initCalls[4] = abi.encodeCall(IB20.revokeRole, (mintRole, address(b20Factory)));
        token = b20Factory.createB20(IB20Factory.B20Variant.ASSET, salt, abi.encode(params), initCalls);
        _openTransferPolicies(token);
        IB20(token).renounceLastAdmin();
    }
}
