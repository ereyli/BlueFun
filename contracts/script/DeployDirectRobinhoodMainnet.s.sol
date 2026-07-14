// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {DirectDexLiquidityLocker} from "../src/DirectDexLiquidityLocker.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmDirectRobinhood {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployDirectRobinhoodMainnet {
    VmDirectRobinhood internal constant vm =
        VmDirectRobinhood(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    event DirectDeployment(address liquidityLocker, address launchFactory, address feeRecipient);

    function run() external {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        vm.startBroadcast(privateKey);

        DirectDexLiquidityLocker locker = new DirectDexLiquidityLocker(
            deployer,
            feeRecipient,
            IUniswapV4PositionManager(POSITION_MANAGER),
            IUniswapV4StateView(STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2)
        );
        DirectErc20LaunchFactory factory = new DirectErc20LaunchFactory(
            deployer, locker, payable(feeRecipient), _defaultConfig(), 0.002 ether
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
            sqrtPriceLowerX96: 269_413_644,
            sqrtPriceUpperX96: 26_813_675_048_711_538_913_286_350_543_688_030,
            platformShareBps: 7_000,
            creatorShareBps: 3_000
        });
    }
}
