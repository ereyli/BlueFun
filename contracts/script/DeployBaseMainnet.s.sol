// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IB20Factory} from "../src/interfaces/IB20Factory.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {GraduationManager} from "../src/GraduationManager.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4StateView,
    IUniswapV4PositionManager,
    UniswapV4LiquidityLocker
} from "../src/UniswapV4LiquidityLocker.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";

interface Vm {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployBaseMainnet {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant UNISWAP_V4_POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant UNISWAP_V4_STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    event Deployed(
        address bondingCurveMarket,
        address graduationManager,
        address liquidityLocker,
        address launchFactory,
        address feeRecipient
    );

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast(deployerPrivateKey);

        BondingCurveMarket market = new BondingCurveMarket(deployer, feeRecipient);
        UniswapV4LiquidityLocker locker = new UniswapV4LiquidityLocker(
            deployer,
            IUniswapV4PositionManager(UNISWAP_V4_POSITION_MANAGER),
            IUniswapV4StateView(UNISWAP_V4_STATE_VIEW),
            IPermit2AllowanceTransfer(PERMIT2),
            3_000,
            60,
            address(0)
        );
        GraduationManager graduation = new GraduationManager(
            market,
            locker,
            IPolicyRegistry(B20Constants.POLICY_REGISTRY)
        );
        locker.setGraduationManager(address(graduation));
        LaunchFactory factory = new LaunchFactory(
            deployer,
            IB20Factory(B20Constants.B20_FACTORY),
            IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
            IPolicyRegistry(B20Constants.POLICY_REGISTRY),
            market,
            address(graduation),
            payable(feeRecipient)
        );
        market.configure(address(factory), address(graduation), feeRecipient);

        vm.stopBroadcast();

        emit Deployed(address(market), address(graduation), address(locker), address(factory), feeRecipient);
    }
}
