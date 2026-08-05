// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {ICore} from "ekubo-v3/src/interfaces/ICore.sol";
import {IPositions} from "ekubo-v3/src/interfaces/IPositions.sol";
import {IB20Factory} from "../../src/interfaces/IB20Factory.sol";
import {IActivationRegistry} from "../../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../../src/interfaces/IPolicyRegistry.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {B20Constants} from "../../src/libraries/B20Constants.sol";
import {BlueEkuboExtension} from "../src/BlueEkuboExtension.sol";
import {BlueEkuboRouter} from "../src/BlueEkuboRouter.sol";
import {EkuboLiquidityLocker} from "../src/EkuboLiquidityLocker.sol";
import {EkuboDirectB20LaunchFactory} from "../src/EkuboDirectB20LaunchFactory.sol";

interface VmDeployEkuboBase {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployEkuboBaseMainnet {
    VmDeployEkuboBase private constant VM =
        VmDeployEkuboBase(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    ICore private constant CORE = ICore(payable(0x00000000000014aA86C5d3c41765bb24e11bd701));
    IPositions private constant POSITIONS = IPositions(payable(0x02D9876A21AF7545f8632C3af76eC90b5ad4b66D));
    IFeePolicy private constant POLICY = IFeePolicy(0xe5c5585aB34F8e2ba55C30Ef5E6b0254d87a4941);
    IRevenueRouter private constant REVENUE = IRevenueRouter(0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741);
    address private constant GOVERNANCE = 0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26;
    uint32 private constant TICK_SPACING = 20_000;
    int32 private constant INITIAL_TICK = 25_460_000;
    int32 private constant TICK_LOWER = -88_720_000;
    int32 private constant TICK_UPPER = 19_920_000;

    event EkuboBaseDeployment(address extension, address router, address locker, address factory);

    function run() external {
        require(block.chainid == 8453, "BASE_ONLY");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        VM.startBroadcast(key);

        BlueEkuboExtension extension = _deployExtension(deployer);
        BlueEkuboRouter router = new BlueEkuboRouter(CORE, POLICY, REVENUE, extension, TICK_SPACING);
        EkuboLiquidityLocker locker = new EkuboLiquidityLocker(
            deployer, POSITIONS, extension, TICK_SPACING, INITIAL_TICK, TICK_LOWER, TICK_UPPER
        );
        EkuboDirectB20LaunchFactory factory = new EkuboDirectB20LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            locker,
            router,
            POLICY,
            REVENUE
        );
        extension.configure(address(router), address(locker), address(POSITIONS));
        locker.setFactory(address(factory));
        factory.transferOwnership(GOVERNANCE);
        VM.stopBroadcast();
        emit EkuboBaseDeployment(address(extension), address(router), address(locker), address(factory));
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
