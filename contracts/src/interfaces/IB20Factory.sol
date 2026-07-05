// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IB20Factory {
    enum B20Variant {
        ASSET,
        STABLECOIN
    }

    struct B20AssetCreateParams {
        uint8 version;
        string name;
        string symbol;
        address initialAdmin;
        uint8 decimals;
    }

    function createB20(B20Variant variant, bytes32 salt, bytes calldata params, bytes[] calldata initCalls)
        external
        returns (address token);

    function getB20Address(B20Variant variant, address deployer, bytes32 salt) external view returns (address token);
    function isB20(address token) external view returns (bool);
    function isB20Initialized(address token) external view returns (bool);
}
