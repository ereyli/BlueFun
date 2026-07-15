// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20Factory} from "../src/interfaces/IB20Factory.sol";
import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {DirectB20LaunchFactory} from "../src/DirectB20LaunchFactory.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {DirectFeeBurnHook} from "../src/DirectFeeBurnHook.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmDirectFeeBurnBase {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployDirectFeeBurnBaseMainnet {
    VmDirectFeeBurnBase internal constant vm =
        VmDirectFeeBurnBase(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 internal constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 internal constant REQUIRED_HOOK_FLAGS = 0x20c4;

    event DirectFeeBurnDeployment(address hook, address liquidityLocker, address launchFactory, address feeRecipient);

    function run() external {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        vm.startBroadcast(privateKey);
        DirectFeeBurnHook hook = _deployHook(deployer, feeRecipient);
        DirectDexLiquidityLocker locker = new DirectDexLiquidityLocker(
            deployer,
            feeRecipient,
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(address(hook))
        );
        DirectB20LaunchFactory factory = new DirectB20LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            locker,
            payable(feeRecipient),
            _config(),
            0.002 ether
        );
        locker.setFactory(address(factory));
        factory.setLaunchRouter(UNIVERSAL_ROUTER);
        address[] memory lockers = new address[](1);
        lockers[0] = address(locker);
        hook.configureLockers(lockers);
        vm.stopBroadcast();
        emit DirectFeeBurnDeployment(address(hook), address(locker), address(factory), feeRecipient);
    }

    function _config() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 0x800000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            initialSqrtPriceX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }

    function _deployHook(address deployer, address feeRecipient) private returns (DirectFeeBurnHook hook) {
        bytes memory initCode = abi.encodePacked(
            type(DirectFeeBurnHook).creationCode, abi.encode(deployer, POOL_MANAGER, feeRecipient)
        );
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash)))));
            if ((uint160(predicted) & ALL_HOOK_MASK) == REQUIRED_HOOK_FLAGS) break;
        }
        if (predicted.code.length == 0) {
            (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
            require(ok && predicted.code.length > 0, "HOOK_DEPLOY_FAILED");
        }
        return DirectFeeBurnHook(predicted);
    }
}
