// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {Erc20LaunchFactory} from "../src/Erc20LaunchFactory.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {DirectLaunchFactoryBase} from "../src/DirectLaunchFactoryBase.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {RemoteRevenueRouter} from "../src/RemoteRevenueRouter.sol";
import {IERC20Minimal, IUniswapV4PositionManager} from "../src/UniswapV4LiquidityLocker.sol";

interface VmVNextRobinhoodSmoke {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface ISmokePermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface ISmokeUniversalRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

contract SmokeVNextRobinhoodMainnet {
    VmVNextRobinhoodSmoke private constant VM =
        VmVNextRobinhoodSmoke(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant BOND_FACTORY = 0x32af28dfE63ff9e84399f0af51d5B84b4f3B3c62;
    address private constant BOND_MARKET = 0x2F46a783C1314e160d673F927464d85B7364D807;
    address private constant DIRECT_FACTORY = 0x7De3165634679353a36886DCfe35e3521beee4A4;
    address private constant HOOK = 0x4C77A461669c0345960dD33d415747c8932F60cC;
    address private constant ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant REVENUE_ROUTER = 0xF42f51728ddffF6B4a556175DC5E5b68a1e5371B;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant INITIAL_BUY = 0.00001 ether;

    event SmokeCompleted(
        uint256 bondLaunchId,
        address bondToken,
        uint256 directLaunchId,
        address directToken,
        uint256 bridgeReserve
    );

    function run() external {
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        uint256 bridgeBefore = RemoteRevenueRouter(payable(REVENUE_ROUTER)).pendingBridgeReserve();

        VM.startBroadcast(key);
        (uint256 bondLaunchId, address bondToken) = _smokeBond(deployer);
        (uint256 directLaunchId, address directToken) = _smokeDirect(deployer);
        VM.stopBroadcast();

        uint256 bridgeAfter = RemoteRevenueRouter(payable(REVENUE_ROUTER)).pendingBridgeReserve();
        require(bridgeAfter > bridgeBefore, "NO_BRIDGE_REVENUE");
        emit SmokeCompleted(bondLaunchId, bondToken, directLaunchId, directToken, bridgeAfter);
    }

    function _smokeBond(address deployer) private returns (uint256 launchId, address token) {
        Erc20LaunchFactory.TokenMetadata memory metadata = Erc20LaunchFactory.TokenMetadata({
            name: "BlueFun vNext Bond Smoke",
            symbol: "BVBS",
            contractURI: "ipfs://bluefun-vnext-robinhood-bond-smoke",
            salt: keccak256(abi.encodePacked("vnext-bond-smoke", block.chainid, block.number))
        });
        BondingCurveMarket.CurveConfig memory curve = BondingCurveMarket.CurveConfig({
            virtualTokenReserve: 1_000_000_000 ether,
            virtualEthReserve: 1.25 ether,
            graduationEthTarget: 5 ether,
            maxSupply: 1_000_000_000 ether
        });
        BondingCurveMarket.LaunchConfig memory config = BondingCurveMarket.LaunchConfig({
            perWalletCap: 900_000_000 ether,
            creatorAllocation: 0,
            platformFeeBps: 70,
            creatorFeeBps: 30,
            antiSnipingDuration: 60,
            antiSnipingMaxBuy: 500_000_000 ether
        });
        (launchId, token) = Erc20LaunchFactory(BOND_FACTORY).createLaunch{value: 0.001 ether + INITIAL_BUY}(
            metadata, curve, config
        );
        uint256 balance = IERC20Minimal(token).balanceOf(deployer);
        require(balance != 0, "NO_BOND_BUY");
        uint256 sellAmount = balance / 4;
        uint256 deadBefore = IERC20Minimal(token).balanceOf(DEAD);
        IERC20Minimal(token).approve(BOND_MARKET, sellAmount);
        BondingCurveMarket(payable(BOND_MARKET)).sell(launchId, sellAmount, 0, block.timestamp + 1 hours);
        require(IERC20Minimal(token).balanceOf(DEAD) - deadBefore == (sellAmount * 30) / 10_000, "BOND_BURN");
    }

    function _smokeDirect(address deployer) private returns (uint256 launchId, address token) {
        DirectErc20LaunchFactory factory = DirectErc20LaunchFactory(DIRECT_FACTORY);
        DirectLaunchFactoryBase.TokenMetadata memory metadata = DirectLaunchFactoryBase.TokenMetadata({
            name: "BlueFun vNext Direct Smoke",
            symbol: "BVDS",
            contractURI: "ipfs://bluefun-vnext-robinhood-direct-smoke",
            salt: keccak256(abi.encodePacked("vnext-direct-smoke", block.chainid, block.number))
        });
        bytes32 poolId;
        (launchId, token, poolId,) = factory.createLaunchWithInitialBuy{value: 0.001 ether + INITIAL_BUY}(
            metadata, factory.launchConfigHash(), block.timestamp + 1 hours, 1
        );
        uint256 balance = IERC20Minimal(token).balanceOf(deployer);
        require(balance != 0, "NO_DIRECT_BUY");
        require(UnifiedFeeHook(payable(HOOK)).creatorNativeRevenue(poolId) != 0, "NO_CREATOR_REVENUE");

        uint256 sellAmount = balance / 4;
        IERC20Minimal(token).approve(PERMIT2, type(uint256).max);
        ISmokePermit2(PERMIT2).approve(token, ROUTER, type(uint160).max, type(uint48).max);
        uint256 deadBefore = IERC20Minimal(token).balanceOf(DEAD);
        _sellDirect(token, sellAmount);
        require(IERC20Minimal(token).balanceOf(DEAD) - deadBefore == (sellAmount * 30) / 10_000, "DIRECT_BURN");
    }

    function _sellDirect(address token, uint256 amount) private {
        ISmokeUniversalRouter.ExactInputSingleParams memory swap = ISmokeUniversalRouter.ExactInputSingleParams({
            poolKey: IUniswapV4PositionManager.PoolKey({
                currency0: address(0), currency1: token, fee: 0x800000, tickSpacing: 200, hooks: HOOK
            }),
            zeroForOne: false,
            amountIn: uint128(amount),
            amountOutMinimum: 0,
            hookData: bytes("")
        });
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(swap);
        params[1] = abi.encode(token, amount);
        params[2] = abi.encode(address(0), 0);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(bytes(hex"060c0f"), params);
        ISmokeUniversalRouter(ROUTER).execute(hex"10", inputs, block.timestamp + 1 hours);
    }
}
