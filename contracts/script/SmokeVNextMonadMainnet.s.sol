// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {DirectLaunchFactoryBase} from "../src/DirectLaunchFactoryBase.sol";
import {DirectErc20LaunchFactory} from "../src/DirectErc20LaunchFactory.sol";
import {MonadLaunchFactory} from "../src/monad/MonadLaunchFactory.sol";
import {MonadRevenueRouter} from "../src/monad/MonadRevenueRouter.sol";
import {UnifiedFeeHook} from "../src/UnifiedFeeHook.sol";
import {IERC20Minimal, IPermit2AllowanceTransfer, IUniswapV4PositionManager} from "../src/UniswapV4LiquidityLocker.sol";

interface VmSmokeMonad {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IMonadUniversalRouter {
    struct ExactInputSingleParams {
        IUniswapV4PositionManager.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Mainnet canary covering Bond buy/sell, Direct buy/sell, burn accounting and Safe revenue claims.
contract SmokeVNextMonadMainnet {
    VmSmokeMonad private constant VM = VmSmokeMonad(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SAFE = 0x144A3f70C0bf33124852E3891011e033b909F46d;
    MonadRevenueRouter private constant REVENUE =
        MonadRevenueRouter(payable(0xD9f720a6A06BDe325a252C449E700253B30610ff));
    UnifiedFeeHook private constant HOOK =
        UnifiedFeeHook(payable(0x65aAA8A131B4d4ed7f95C1F88740daeE4e1B20cc));
    BondingCurveMarket private constant MARKET =
        BondingCurveMarket(payable(0xB2a827Da4Bd935902baE6B5640d6384C2ef53821));
    MonadLaunchFactory private constant BOND_FACTORY =
        MonadLaunchFactory(0x857430A20C3A5087e8f4f292B1573507567fa9cB);
    DirectErc20LaunchFactory private constant DIRECT_FACTORY =
        DirectErc20LaunchFactory(0x773260193799321547BFeF0616cf57b3D7aa3412);
    IPermit2AllowanceTransfer private constant PERMIT2 =
        IPermit2AllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    IMonadUniversalRouter private constant UNIVERSAL_ROUTER =
        IMonadUniversalRouter(0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7);
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address private constant EXISTING_BOND_CANARY = 0xfE71f86fC8DeB6334624dB8b6C9c3091e8718eBD;

    event MonadSmokeCompleted(
        uint256 indexed bondLaunchId,
        address indexed bondToken,
        uint256 directLaunchId,
        address directToken,
        bytes32 directPoolId,
        bytes32 directPositionId,
        uint256 safeRevenueClaimed
    );

    function run() external {
        require(block.chainid == 143, "NOT_MONAD_MAINNET");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        uint256 deadline = block.timestamp + 1 hours;

        VM.startBroadcast(key);
        uint256 bondLaunchId;
        address bondToken;
        if (MARKET.launchCount() == 0) {
            (bondLaunchId, bondToken) = BOND_FACTORY.createLaunch{value: 81 ether}(
                MonadLaunchFactory.TokenMetadata({
                    name: "BlueFun Monad Bond Canary",
                    symbol: "BFMBC",
                    contractURI: "ipfs://bluefun-monad-bond-canary",
                    salt: keccak256(abi.encodePacked("bluefun-monad-bond-canary-v1", deployer))
                }),
                BondingCurveMarket.CurveConfig({
                    virtualTokenReserve: 1_000_000_000 ether,
                    virtualEthReserve: 100_000 ether,
                    graduationEthTarget: 400_000 ether,
                    maxSupply: 1_000_000_000 ether
                }),
                BondingCurveMarket.LaunchConfig({
                    perWalletCap: 900_000_000 ether,
                    creatorAllocation: 0,
                    platformFeeBps: 70,
                    creatorFeeBps: 30,
                    antiSnipingDuration: 60,
                    antiSnipingMaxBuy: 500_000_000 ether
                })
            );
        } else {
            require(MARKET.launchCount() == 1, "UNEXPECTED_BOND_LAUNCH_COUNT");
            bondLaunchId = 1;
            bondToken = EXISTING_BOND_CANARY;
        }
        uint256 bondBalance = IERC20Minimal(bondToken).balanceOf(deployer);
        require(bondBalance != 0, "BOND_BUY_FAILED");
        IERC20Minimal(bondToken).approve(address(MARKET), bondBalance / 4);
        MARKET.sell(bondLaunchId, bondBalance / 4, 0, deadline);

        (uint256 directLaunchId, address directToken, bytes32 directPoolId, bytes32 directPositionId) =
            DIRECT_FACTORY.createLaunchWithInitialBuy{value: 81 ether}(
                DirectLaunchFactoryBase.TokenMetadata({
                    name: "BlueFun Monad Direct Canary",
                    symbol: "BFMDC",
                    contractURI: "ipfs://bluefun-monad-direct-canary",
                    salt: keccak256(abi.encodePacked("bluefun-monad-direct-canary-v1", deployer))
                }),
                DIRECT_FACTORY.launchConfigHash(),
                deadline,
                1
            );
        uint256 directBalance = IERC20Minimal(directToken).balanceOf(deployer);
        require(directBalance != 0, "DIRECT_BUY_FAILED");
        uint256 directSellAmount = directBalance / 4;
        uint256 burnedBefore = IERC20Minimal(directToken).balanceOf(DEAD);
        IERC20Minimal(directToken).approve(address(PERMIT2), type(uint256).max);
        PERMIT2.approve(directToken, address(UNIVERSAL_ROUTER), type(uint160).max, type(uint48).max);
        _sellDirect(directToken, directSellAmount, deadline);
        require(
            IERC20Minimal(directToken).balanceOf(DEAD) - burnedBefore == (directSellAmount * 30) / 10_000,
            "DIRECT_BURN_MISMATCH"
        );

        HOOK.claimCreatorRevenue(payable(SAFE));
        MARKET.claimFees();
        uint256 treasuryRevenue = REVENUE.pendingTreasuryRevenue();
        REVENUE.claimTreasuryRevenue();
        VM.stopBroadcast();

        emit MonadSmokeCompleted(
            bondLaunchId,
            bondToken,
            directLaunchId,
            directToken,
            directPoolId,
            directPositionId,
            treasuryRevenue
        );
    }

    function _sellDirect(address token, uint256 amount, uint256 deadline) private {
        IMonadUniversalRouter.ExactInputSingleParams memory swap = IMonadUniversalRouter.ExactInputSingleParams({
            poolKey: IUniswapV4PositionManager.PoolKey({
                currency0: address(0),
                currency1: token,
                fee: 0x800000,
                tickSpacing: 200,
                hooks: address(HOOK)
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
        UNIVERSAL_ROUTER.execute(hex"10", inputs, deadline);
    }
}
