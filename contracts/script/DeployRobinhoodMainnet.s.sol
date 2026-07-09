// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20GraduationManager} from "../src/Erc20GraduationManager.sol";
import {Erc20LaunchFactory} from "../src/Erc20LaunchFactory.sol";
import {IPermit2AllowanceTransfer, IUniswapV4StateView, IUniswapV4PositionManager, UniswapV4LiquidityLocker} from "../src/UniswapV4LiquidityLocker.sol";

interface VmRobinhood {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployRobinhoodMainnet {
    VmRobinhood internal constant vm = VmRobinhood(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant UNISWAP_V4_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant UNISWAP_V4_STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    event Deployed(address bondingCurveMarket, address graduationManager, address liquidityLocker, address launchFactory, address feeRecipient);

    function run() external {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        vm.startBroadcast(privateKey);
        BondingCurveMarket market = new BondingCurveMarket(deployer, feeRecipient);
        UniswapV4LiquidityLocker locker = new UniswapV4LiquidityLocker(deployer, IUniswapV4PositionManager(UNISWAP_V4_POSITION_MANAGER), IUniswapV4StateView(UNISWAP_V4_STATE_VIEW), IPermit2AllowanceTransfer(PERMIT2), 3_000, 60, address(0));
        Erc20GraduationManager graduation = new Erc20GraduationManager(market, locker);
        locker.setGraduationManager(address(graduation));
        Erc20LaunchFactory factory = new Erc20LaunchFactory(deployer, market, address(graduation), payable(feeRecipient));
        market.configure(address(factory), address(graduation), feeRecipient);
        vm.stopBroadcast();
        emit Deployed(address(market), address(graduation), address(locker), address(factory), feeRecipient);
    }
}
