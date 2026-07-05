// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20Factory} from "../../src/interfaces/IB20Factory.sol";
import {MockB20} from "./MockB20.sol";

contract MockB20Factory is IB20Factory {
    mapping(address token => bool valid) public isB20;
    mapping(address token => bool initialized) public isB20Initialized;

    function createB20(B20Variant variant, bytes32 salt, bytes calldata params, bytes[] calldata initCalls)
        external
        returns (address token)
    {
        require(variant == B20Variant.ASSET, "asset only");
        B20AssetCreateParams memory decoded = abi.decode(params, (B20AssetCreateParams));
        bytes32 finalSalt = keccak256(abi.encode(msg.sender, salt));
        MockB20 b20 = new MockB20{salt: finalSalt}(
            decoded.name,
            decoded.symbol,
            decoded.decimals,
            "",
            decoded.initialAdmin,
            address(this)
        );
        token = address(b20);
        isB20[token] = true;

        for (uint256 i = 0; i < initCalls.length; i++) {
            (bool ok, bytes memory returndata) = token.call(initCalls[i]);
            if (!ok) {
                assembly {
                    revert(add(returndata, 32), mload(returndata))
                }
            }
        }

        b20.sealBootstrap();
        isB20Initialized[token] = true;
    }

    function getB20Address(B20Variant, address deployer, bytes32 salt) external view returns (address token) {
        bytes32 finalSalt = keccak256(abi.encode(deployer, salt));
        bytes32 initHash = keccak256(type(MockB20).creationCode);
        token = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), finalSalt, initHash)))));
    }
}
