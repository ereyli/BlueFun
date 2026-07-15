// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {DirectDexLiquidityLocker} from "./DirectDexLiquidityLocker.sol";
import {DirectLaunchFactoryBase} from "./DirectLaunchFactoryBase.sol";
import {StandardLaunchToken} from "./StandardLaunchToken.sol";
import {IFeePolicy} from "./interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "./interfaces/IRevenueRouter.sol";

contract DirectErc20LaunchFactory is DirectLaunchFactoryBase {
    constructor(
        address initialOwner,
        DirectDexLiquidityLocker liquidityLocker_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_,
        DirectDexLiquidityLocker.PoolConfig memory initialConfig
    ) DirectLaunchFactoryBase(initialOwner, liquidityLocker_, feePolicy_, revenueRouter_, initialConfig) {}

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

    function _deployToken(
        TokenMetadata calldata metadata,
        bytes32 effectiveSalt,
        uint256 supply,
        address liquidityRecipient
    )
        internal
        override
        returns (address token)
    {
        token = address(
            new StandardLaunchToken{salt: effectiveSalt}(
                metadata.name, metadata.symbol, metadata.contractURI, liquidityRecipient, supply
            )
        );
    }
}
