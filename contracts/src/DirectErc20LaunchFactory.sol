// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {DirectDexLiquidityLocker} from "./DirectDexLiquidityLocker.sol";
import {DirectLaunchFactoryBase} from "./DirectLaunchFactoryBase.sol";
import {StandardLaunchToken} from "./StandardLaunchToken.sol";

contract DirectErc20LaunchFactory is DirectLaunchFactoryBase {
    constructor(
        address initialOwner,
        DirectDexLiquidityLocker liquidityLocker_,
        address payable launchFeeRecipient_,
        DirectDexLiquidityLocker.PoolConfig memory initialConfig,
        uint256 initialLaunchFee
    ) DirectLaunchFactoryBase(initialOwner, liquidityLocker_, launchFeeRecipient_, initialConfig, initialLaunchFee) {}

    function predictTokenAddress(TokenMetadata calldata metadata) external view returns (address) {
        bytes memory init = abi.encodePacked(
            type(StandardLaunchToken).creationCode,
            abi.encode(metadata.name, metadata.symbol, metadata.contractURI, address(liquidityLocker), MAX_SUPPLY)
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), metadata.salt, keccak256(init)))))
        );
    }

    function _deployToken(TokenMetadata calldata metadata, uint256 supply, address liquidityRecipient)
        internal
        override
        returns (address token)
    {
        token = address(
            new StandardLaunchToken{salt: metadata.salt}(
                metadata.name, metadata.symbol, metadata.contractURI, liquidityRecipient, supply
            )
        );
    }
}
