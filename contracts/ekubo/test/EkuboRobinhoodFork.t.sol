// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {Test} from "../../test/utils/Test.sol";
import {ICore} from "ekubo-v3/src/interfaces/ICore.sol";
import {IPositions} from "ekubo-v3/src/interfaces/IPositions.sol";
import {PoolId} from "ekubo-v3/src/types/poolId.sol";
import {PoolKey} from "ekubo-v3/src/types/poolKey.sol";
import {SqrtRatio} from "ekubo-v3/src/types/sqrtRatio.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {BlueEkuboExtension} from "../src/BlueEkuboExtension.sol";
import {BlueEkuboRouter} from "../src/BlueEkuboRouter.sol";
import {EkuboLiquidityLocker} from "../src/EkuboLiquidityLocker.sol";
import {EkuboDirectErc20LaunchFactory} from "../src/EkuboDirectErc20LaunchFactory.sol";
import {EkuboDirectLaunchFactoryBase} from "../src/EkuboDirectLaunchFactoryBase.sol";

interface IERC20EkuboFork {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract EkuboRobinhoodForkTest is Test {
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    ICore private constant CORE = ICore(payable(0x00000000000014aA86C5d3c41765bb24e11bd701));
    IPositions private constant POSITIONS = IPositions(payable(0x02D9876A21AF7545f8632C3af76eC90b5ad4b66D));
    IFeePolicy private constant POLICY = IFeePolicy(0x4D0baaCfb8267C8f7ca39756Bb29f924dDd72a6a);
    IRevenueRouter private constant REVENUE = IRevenueRouter(0xF42f51728ddffF6B4a556175DC5E5b68a1e5371B);

    receive() external payable {}

    function testRobinhoodEkuboLaunchBuySellAndFeeGate() public {
        if (block.chainid != 4663) return;
        vm.deal(address(this), 10 ether);

        BlueEkuboExtension extension = _deployExtension();
        BlueEkuboRouter router = new BlueEkuboRouter(CORE, POLICY, REVENUE, extension, 20_000);
        EkuboLiquidityLocker locker = new EkuboLiquidityLocker(
            address(this), POSITIONS, extension, 20_000, 25_460_000, -88_720_000, 19_920_000
        );
        EkuboDirectErc20LaunchFactory factory =
            new EkuboDirectErc20LaunchFactory(address(this), locker, router, POLICY, REVENUE);
        extension.configure(address(router), address(locker), address(POSITIONS));
        locker.setFactory(address(factory));

        EkuboDirectLaunchFactoryBase.TokenMetadata memory metadata =
            EkuboDirectLaunchFactoryBase.TokenMetadata({
                name: "Blue Ekubo Fork",
                symbol: "BEKU",
                contractURI: "ipfs://blue-ekubo-fork",
                salt: keccak256("blue-ekubo-robinhood-fork")
            });
        uint256 launchFee = factory.launchFee();
        (uint256 launchId, address token, PoolId poolId, bytes32 positionId) = factory.createLaunchWithInitialBuy{
            value: launchFee + 0.01 ether
        }(metadata, factory.launchConfigHash(), block.timestamp + 1 hours, 1);

        assertEq(launchId, 1_000_001);
        assertTrue(PoolId.unwrap(poolId) != bytes32(0));
        assertTrue(positionId != bytes32(0));
        uint256 bought = IERC20EkuboFork(token).balanceOf(address(this));
        assertGt(bought, 0);
        assertGt(router.pendingCreatorRevenue(address(this)), 0);

        uint128 quote = router.quoteBuy(token, uint128(0.001 ether));
        assertGt(quote, 0);
        uint128 extraBought = router.buy{value: 0.001 ether}(token, 1, address(this));
        assertGt(extraBought, 0);

        uint128 sellAmount = uint128((bought + extraBought) / 2);
        IERC20EkuboFork(token).approve(address(router), sellAmount);
        uint128 nativeQuote = router.quoteSell(token, sellAmount);
        assertGt(nativeQuote, 0);
        uint256 nativeBefore = address(this).balance;
        uint128 nativeOut = router.sell(token, sellAmount, 1, payable(address(this)));
        assertGt(nativeOut, 0);
        assertEq(address(this).balance - nativeBefore, nativeOut);

        PoolKey memory key = router.poolKey(token);
        vm.expectRevert(BlueEkuboRouter.UnauthorizedOperation.selector);
        router.swap(key, false, int128(1), SqrtRatio.wrap(0), 0, 0, address(this));
    }

    function _deployExtension() private returns (BlueEkuboExtension extension) {
        bytes memory initCode =
            abi.encodePacked(type(BlueEkuboExtension).creationCode, abi.encode(CORE, address(this)));
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt = bytes32(uint256(490));
        address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), CREATE2_DEPLOYER, salt, initCodeHash
        )))));
        require(uint8(bytes1(bytes20(predicted))) == 0x41, "INVALID_EXTENSION_SALT");
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && predicted.code.length != 0, "EXTENSION_DEPLOY_FAILED");
        return BlueEkuboExtension(predicted);
    }
}
