// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20} from "./interfaces/IB20.sol";
import {IB20Factory} from "./interfaces/IB20Factory.sol";
import {IActivationRegistry} from "./interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {B20Constants} from "./libraries/B20Constants.sol";
import {PolicyGuard} from "./PolicyGuard.sol";
import {DirectDexLiquidityLocker} from "./DirectDexLiquidityLocker.sol";
import {DirectLaunchFactoryBase} from "./DirectLaunchFactoryBase.sol";

contract DirectB20LaunchFactory is DirectLaunchFactoryBase, PolicyGuard {
    error B20AssetNotActivated();

    IB20Factory public immutable b20Factory;
    IActivationRegistry public immutable activationRegistry;
    bool public activationGateEnabled = true;

    event ActivationGateUpdated(bool enabled);

    constructor(
        address initialOwner,
        IB20Factory b20Factory_,
        IActivationRegistry activationRegistry_,
        IPolicyRegistry policyRegistry_,
        DirectDexLiquidityLocker liquidityLocker_,
        address payable launchFeeRecipient_,
        DirectDexLiquidityLocker.PoolConfig memory initialConfig,
        uint256 initialLaunchFee
    )
        DirectLaunchFactoryBase(initialOwner, liquidityLocker_, launchFeeRecipient_, initialConfig, initialLaunchFee)
        PolicyGuard(policyRegistry_)
    {
        if (address(b20Factory_) == address(0) || address(activationRegistry_) == address(0)) {
            revert InvalidLaunchConfig();
        }
        b20Factory = b20Factory_;
        activationRegistry = activationRegistry_;
    }

    function setActivationGateEnabled(bool enabled) external onlyOwner {
        activationGateEnabled = enabled;
        emit ActivationGateUpdated(enabled);
    }

    function predictTokenAddress(TokenMetadata calldata metadata) external view returns (address) {
        return b20Factory.getB20Address(IB20Factory.B20Variant.ASSET, address(this), metadata.salt);
    }

    function _deployToken(TokenMetadata calldata metadata, uint256 supply, address liquidityRecipient)
        internal
        override
        returns (address token)
    {
        if (activationGateEnabled && !activationRegistry.isActivated(B20Constants.B20_ASSET_FEATURE)) {
            revert B20AssetNotActivated();
        }

        bytes[] memory initCalls = new bytes[](5);
        IB20Factory.B20AssetCreateParams memory params = IB20Factory.B20AssetCreateParams({
            version: 1, name: metadata.name, symbol: metadata.symbol, initialAdmin: address(this), decimals: 18
        });
        bytes32 mintRole = keccak256("MINT_ROLE");
        initCalls[0] = abi.encodeCall(IB20.updateSupplyCap, (supply));
        initCalls[1] = abi.encodeCall(IB20.updateContractURI, (metadata.contractURI));
        initCalls[2] = abi.encodeCall(IB20.grantRole, (mintRole, address(b20Factory)));
        initCalls[3] = abi.encodeCall(IB20.mint, (liquidityRecipient, supply));
        initCalls[4] = abi.encodeCall(IB20.revokeRole, (mintRole, address(b20Factory)));

        token = b20Factory.createB20(IB20Factory.B20Variant.ASSET, metadata.salt, abi.encode(params), initCalls);
        _openTransferPolicies(token);
        IB20(token).renounceLastAdmin();
    }
}
