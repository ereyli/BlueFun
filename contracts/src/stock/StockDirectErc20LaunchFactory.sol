// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StockDirectLaunchFactoryBase} from "./StockDirectLaunchFactoryBase.sol";
import {StockQuoteRegistry} from "./StockQuoteRegistry.sol";
import {StockLiquidityLocker} from "./StockLiquidityLocker.sol";
import {StandardLaunchToken} from "../StandardLaunchToken.sol";
import {IPermit2AllowanceTransfer} from "../UniswapV4LiquidityLocker.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";

contract StockDirectErc20LaunchFactory is StockDirectLaunchFactoryBase {
    constructor(
        address initialOwner,
        StockLiquidityLocker locker,
        StockQuoteRegistry registry,
        IFeePolicy policy,
        IRevenueRouter revenueRouter,
        IPermit2AllowanceTransfer permit2,
        LaunchConfig memory initialConfig
    ) StockDirectLaunchFactoryBase(initialOwner, locker, registry, policy, revenueRouter, permit2, initialConfig) {}

    function predictTokenAddress(address creator, address quoteToken, TokenMetadata calldata metadata)
        external
        view
        returns (address)
    {
        bytes32 salt = keccak256(abi.encode(creator, block.chainid, quoteToken, metadata.salt));
        bytes memory init = abi.encodePacked(
            type(StandardLaunchToken).creationCode,
            abi.encode(metadata.name, metadata.symbol, metadata.contractURI, address(liquidityLocker), MAX_SUPPLY)
        );
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(init))))));
    }

    function _deployToken(TokenMetadata calldata metadata, bytes32 salt, uint256 supply, address recipient)
        internal
        override
        returns (address token)
    {
        token = address(
            new StandardLaunchToken{salt: salt}(metadata.name, metadata.symbol, metadata.contractURI, recipient, supply)
        );
    }
}
