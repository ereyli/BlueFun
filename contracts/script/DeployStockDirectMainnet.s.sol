// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StockQuoteRegistry} from "../src/stock/StockQuoteRegistry.sol";
import {StockFeeHook} from "../src/stock/StockFeeHook.sol";
import {StockLiquidityLocker, IStockPoolInitializationGuard} from "../src/stock/StockLiquidityLocker.sol";
import {StockDirectLaunchFactoryBase} from "../src/stock/StockDirectLaunchFactoryBase.sol";
import {StockDirectB20LaunchFactory} from "../src/stock/StockDirectB20LaunchFactory.sol";
import {StockDirectErc20LaunchFactory} from "../src/stock/StockDirectErc20LaunchFactory.sol";
import {IB20Factory} from "../src/interfaces/IB20Factory.sol";
import {IActivationRegistry} from "../src/interfaces/IActivationRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {B20Constants} from "../src/libraries/B20Constants.sol";
import {IFeePolicy} from "../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../src/interfaces/IRevenueRouter.sol";
import {
    IPermit2AllowanceTransfer,
    IUniswapV4PositionManager,
    IUniswapV4StateView
} from "../src/UniswapV4LiquidityLocker.sol";

interface VmStockDirect {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the stock-pair suite on Base (8453) or Robinhood Chain (4663).
/// @dev Asset configuration is deliberately separate; run scripts/sync-stock-registry.mjs
///      while the deployer is registry admin, then complete the two-step timelock handoff.
contract DeployStockDirectMainnet {
    VmStockDirect private constant VM = VmStockDirect(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint160 private constant HOOK_FLAGS = (1 << 13) | (1 << 7) | (1 << 6) | (1 << 3) | (1 << 2);

    event StockDirectDeployment(
        uint256 indexed chainId,
        address registry,
        address hook,
        address locker,
        address factory,
        address governance,
        address priceSigner
    );

    function run() external {
        require(block.chainid == 8453 || block.chainid == 4663, "UNSUPPORTED_CHAIN");
        uint256 key = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(key);
        address governance = VM.envAddress("STOCK_GOVERNANCE");
        address priceSigner = VM.envAddress("STOCK_PRICE_SIGNER");
        address platformRecipient = VM.envAddress("STOCK_PLATFORM_FEE_RECIPIENT");
        IFeePolicy policy = IFeePolicy(VM.envAddress("STOCK_FEE_POLICY"));
        IRevenueRouter revenueRouter = IRevenueRouter(VM.envAddress("STOCK_REVENUE_ROUTER"));
        (address poolManager, address positionManager, address stateView, address universalRouter) = _uniswap();

        VM.startBroadcast(key);
        StockQuoteRegistry registry = new StockQuoteRegistry(deployer, priceSigner);
        StockFeeHook hook = _deployHook(deployer, poolManager, platformRecipient, policy);
        StockLiquidityLocker locker = new StockLiquidityLocker(
            deployer,
            IUniswapV4PositionManager(positionManager),
            IUniswapV4StateView(stateView),
            IPermit2AllowanceTransfer(PERMIT2),
            IStockPoolInitializationGuard(address(hook))
        );
        StockDirectLaunchFactoryBase factory;
        if (block.chainid == 8453) {
            factory = new StockDirectB20LaunchFactory(
                deployer,
                IB20Factory(B20Constants.B20_FACTORY),
                IActivationRegistry(B20Constants.ACTIVATION_REGISTRY),
                IPolicyRegistry(B20Constants.POLICY_REGISTRY),
                locker,
                registry,
                policy,
                revenueRouter,
                IPermit2AllowanceTransfer(PERMIT2),
                _launchConfig()
            );
        } else {
            factory = new StockDirectErc20LaunchFactory(
                deployer,
                locker,
                registry,
                policy,
                revenueRouter,
                IPermit2AllowanceTransfer(PERMIT2),
                _launchConfig()
            );
        }
        locker.setFactory(address(factory));
        factory.setLaunchRouter(universalRouter);
        address[] memory lockers = new address[](1);
        lockers[0] = address(locker);
        hook.configureLockers(lockers);
        factory.transferOwnership(governance);
        registry.proposeAdmin(governance);
        VM.stopBroadcast();

        emit StockDirectDeployment(
            block.chainid, address(registry), address(hook), address(locker), address(factory), governance, priceSigner
        );
    }

    function _launchConfig() private pure returns (StockDirectLaunchFactoryBase.LaunchConfig memory) {
        return StockDirectLaunchFactoryBase.LaunchConfig({
            tickSpacing: 60,
            rangeWidthTicks: 120_000,
            targetFdvUsd18: 3_000 ether
        });
    }

    function _uniswap() private view returns (address, address, address, address) {
        if (block.chainid == 8453) {
            return (
                0x498581fF718922c3f8e6A244956aF099B2652b2b,
                0x7C5f5A4bBd8fD63184577525326123B519429bDc,
                0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71,
                0x6fF5693b99212Da76ad316178A184AB56D299b43
            );
        }
        return (
            0x8366a39CC670B4001A1121B8F6A443A643e40951,
            0x58daec3116aae6D93017bAAea7749052E8a04fA7,
            0xF3334192D15450CdD385c8B70e03f9A6bD9E673b,
            0x8876789976dEcBfCbBbe364623C63652db8C0904
        );
    }

    function _deployHook(address deployer, address poolManager, address recipient, IFeePolicy policy)
        private
        returns (StockFeeHook hook)
    {
        bytes memory initCode = abi.encodePacked(
            type(StockFeeHook).creationCode, abi.encode(deployer, poolManager, recipient, policy)
        );
        bytes32 hash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, salt, hash))))
            );
            if ((uint160(predicted) & ALL_HOOK_MASK) == HOOK_FLAGS) break;
        }
        require(predicted.code.length == 0, "HOOK_ALREADY_DEPLOYED");
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && predicted.code.length != 0, "HOOK_DEPLOY_FAILED");
        return StockFeeHook(predicted);
    }
}
