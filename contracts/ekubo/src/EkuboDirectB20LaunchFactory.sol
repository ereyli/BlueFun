// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {IB20} from "../../src/interfaces/IB20.sol";
import {IB20Factory} from "../../src/interfaces/IB20Factory.sol";
import {IActivationRegistry} from "../../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {B20Constants} from "../../src/libraries/B20Constants.sol";
import {PolicyGuard} from "../../src/PolicyGuard.sol";
import {BlueEkuboRouter} from "./BlueEkuboRouter.sol";
import {EkuboDirectLaunchFactoryBase} from "./EkuboDirectLaunchFactoryBase.sol";
import {EkuboLiquidityLocker} from "./EkuboLiquidityLocker.sol";

contract EkuboDirectB20LaunchFactory is EkuboDirectLaunchFactoryBase, PolicyGuard {
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
        EkuboLiquidityLocker liquidityLocker_,
        BlueEkuboRouter swapRouter_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_
    )
        EkuboDirectLaunchFactoryBase(initialOwner, liquidityLocker_, swapRouter_, feePolicy_, revenueRouter_)
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

    function predictTokenAddress(address creator, TokenMetadata calldata metadata) external view returns (address) {
        bytes32 effectiveSalt = keccak256(abi.encode(creator, block.chainid, metadata.salt, "EKUBO"));
        return b20Factory.getB20Address(IB20Factory.B20Variant.ASSET, address(this), effectiveSalt);
    }

    function _deployToken(
        TokenMetadata calldata metadata,
        bytes32 effectiveSalt,
        uint256 supply,
        address liquidityRecipient
    ) internal override returns (address token) {
        if (activationGateEnabled && !activationRegistry.isActivated(B20Constants.B20_ASSET_FEATURE)) {
            revert B20AssetNotActivated();
        }

        bytes[] memory initCalls = new bytes[](5);
        IB20Factory.B20AssetCreateParams memory params = IB20Factory.B20AssetCreateParams({
            version: 1,
            name: metadata.name,
            symbol: metadata.symbol,
            initialAdmin: address(this),
            decimals: 18
        });
        bytes32 mintRole = keccak256("MINT_ROLE");
        initCalls[0] = abi.encodeCall(IB20.updateSupplyCap, (supply));
        initCalls[1] = abi.encodeCall(IB20.updateContractURI, (metadata.contractURI));
        initCalls[2] = abi.encodeCall(IB20.grantRole, (mintRole, address(b20Factory)));
        initCalls[3] = abi.encodeCall(IB20.mint, (liquidityRecipient, supply));
        initCalls[4] = abi.encodeCall(IB20.revokeRole, (mintRole, address(b20Factory)));

        token = b20Factory.createB20(IB20Factory.B20Variant.ASSET, effectiveSalt, abi.encode(params), initCalls);
        _openTransferPolicies(token);
        IB20(token).renounceLastAdmin();
    }
}
