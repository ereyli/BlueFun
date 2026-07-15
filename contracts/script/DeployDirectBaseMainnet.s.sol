// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IB20Factory} from "../src/interfaces/IB20Factory.sol";
import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {DirectB20LaunchFactory} from "../src/DirectB20LaunchFactory.sol";
import {DirectDexLiquidityLocker, IPoolInitializationGuard} from "../src/DirectDexLiquidityLocker.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmDirectBase {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployDirectBaseMainnet {
    VmDirectBase internal constant vm = VmDirectBase(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    event DirectDeployment(address liquidityLocker, address launchFactory, address feeRecipient);

    function run() external {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address initializationHook = vm.envAddress("INITIALIZATION_HOOK");
        vm.startBroadcast(privateKey);

        DirectDexLiquidityLocker locker = new DirectDexLiquidityLocker(
            deployer,
            feeRecipient,
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            IPoolInitializationGuard(initializationHook)
        );
        DirectB20LaunchFactory factory = new DirectB20LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            locker,
            payable(feeRecipient),
            _defaultConfig(),
            0.002 ether
        );
        locker.setFactory(address(factory));
        vm.stopBroadcast();
        emit DirectDeployment(address(locker), address(factory), feeRecipient);
    }

    function _defaultConfig() private pure returns (DirectDexLiquidityLocker.PoolConfig memory) {
        return DirectDexLiquidityLocker.PoolConfig({
            poolFee: 10_000,
            tickSpacing: 200,
            tickLower: -887_200,
            tickUpper: 199_200,
            initialSqrtPriceX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }
}
