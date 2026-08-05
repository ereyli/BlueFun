// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {StandardLaunchToken} from "../../src/StandardLaunchToken.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {BlueEkuboRouter} from "./BlueEkuboRouter.sol";
import {EkuboDirectLaunchFactoryBase} from "./EkuboDirectLaunchFactoryBase.sol";
import {EkuboLiquidityLocker} from "./EkuboLiquidityLocker.sol";

contract EkuboDirectErc20LaunchFactory is EkuboDirectLaunchFactoryBase {
    constructor(
        address initialOwner,
        EkuboLiquidityLocker liquidityLocker_,
        BlueEkuboRouter swapRouter_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_
    ) EkuboDirectLaunchFactoryBase(initialOwner, liquidityLocker_, swapRouter_, feePolicy_, revenueRouter_) {}

    function predictTokenAddress(address creator, TokenMetadata calldata metadata) external view returns (address) {
        bytes32 effectiveSalt = keccak256(abi.encode(creator, block.chainid, metadata.salt, "EKUBO"));
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
    ) internal override returns (address token) {
        token = address(
            new StandardLaunchToken{salt: effectiveSalt}(
                metadata.name, metadata.symbol, metadata.contractURI, liquidityRecipient, supply
            )
        );
    }
}
