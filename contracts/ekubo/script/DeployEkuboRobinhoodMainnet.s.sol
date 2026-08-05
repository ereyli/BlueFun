// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {ICore} from "ekubo-v3/src/interfaces/ICore.sol";
import {IPositions} from "ekubo-v3/src/interfaces/IPositions.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {BlueEkuboExtension} from "../src/BlueEkuboExtension.sol";
import {BlueEkuboRouter} from "../src/BlueEkuboRouter.sol";
import {EkuboLiquidityLocker} from "../src/EkuboLiquidityLocker.sol";
import {EkuboDirectErc20LaunchFactory} from "../src/EkuboDirectErc20LaunchFactory.sol";

interface VmDeployEkuboRobinhood {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployEkuboRobinhoodMainnet {
    VmDeployEkuboRobinhood private constant VM =
        VmDeployEkuboRobinhood(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    ICore private constant CORE = ICore(payable(0x00000000000014aA86C5d3c41765bb24e11bd701));
    IPositions private constant POSITIONS = IPositions(payable(0x02D9876A21AF7545f8632C3af76eC90b5ad4b66D));
    IFeePolicy private constant POLICY = IFeePolicy(0x4D0baaCfb8267C8f7ca39756Bb29f924dDd72a6a);
    IRevenueRouter private constant REVENUE = IRevenueRouter(0xF42f51728ddffF6B4a556175DC5E5b68a1e5371B);
    address private constant GOVERNANCE = 0xa64ed8d4C4cAcFF075A4D1d50EE2F7795B4B0039;
    uint32 private constant TICK_SPACING = 20_000;
    int32 private constant INITIAL_TICK = 25_460_000;
    int32 private constant TICK_LOWER = -88_720_000;
    int32 private constant TICK_UPPER = 19_920_000;

    event EkuboRobinhoodDeployment(address extension, address router, address locker, address factory);

    function run() external {
        require(block.chainid == 4663, "ROBINHOOD_ONLY");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        VM.startBroadcast(key);

        BlueEkuboExtension extension = _deployExtension(deployer);
        BlueEkuboRouter router = new BlueEkuboRouter(CORE, POLICY, REVENUE, extension, TICK_SPACING);
        EkuboLiquidityLocker locker = new EkuboLiquidityLocker(
            deployer, POSITIONS, extension, TICK_SPACING, INITIAL_TICK, TICK_LOWER, TICK_UPPER
        );
        EkuboDirectErc20LaunchFactory factory =
            new EkuboDirectErc20LaunchFactory(deployer, locker, router, POLICY, REVENUE);
        extension.configure(address(router), address(locker), address(POSITIONS));
        locker.setFactory(address(factory));
        factory.transferOwnership(GOVERNANCE);
        VM.stopBroadcast();
        emit EkuboRobinhoodDeployment(address(extension), address(router), address(locker), address(factory));
    }

    function _deployExtension(address owner) private returns (BlueEkuboExtension extension) {
        bytes memory initCode = abi.encodePacked(type(BlueEkuboExtension).creationCode, abi.encode(CORE, owner));
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 i;; ++i) {
            bytes32 salt = bytes32(i);
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash
            )))));
            if (uint8(bytes1(bytes20(predicted))) != 0x41) continue;
            require(predicted.code.length == 0, "EXTENSION_ALREADY_DEPLOYED");
            (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
            require(ok && predicted.code.length != 0, "EXTENSION_DEPLOY_FAILED");
            return BlueEkuboExtension(predicted);
        }
    }
}
