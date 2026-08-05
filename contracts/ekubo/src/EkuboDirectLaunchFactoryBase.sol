// SPDX-License-Identifier: ekubo-license-v1.eth
pragma solidity =0.8.33;

import {PoolId} from "ekubo-v3/src/types/poolId.sol";
import {Ownable} from "../../src/access/Ownable.sol";
import {ReentrancyGuard} from "../../src/security/ReentrancyGuard.sol";
import {IFeePolicy} from "../../src/interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../../src/interfaces/IRevenueRouter.sol";
import {BlueEkuboRouter} from "./BlueEkuboRouter.sol";
import {EkuboLiquidityLocker} from "./EkuboLiquidityLocker.sol";

abstract contract EkuboDirectLaunchFactoryBase is Ownable, ReentrancyGuard {
    error InvalidLaunchConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee();
    error SaltAlreadyUsed();
    error DeadlineExpired();
    error LaunchConfigChanged();
    error InitialBuyFailed();
    error InitialBuyExceedsFivePercent();
    error LaunchesPaused();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_INITIAL_BUY_TOKENS = MAX_SUPPLY / 20;
    uint256 public constant EKUBO_LAUNCH_ID_OFFSET = 1_000_000;

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    EkuboLiquidityLocker public immutable liquidityLocker;
    BlueEkuboRouter public immutable swapRouter;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    uint256 public launchCount = EKUBO_LAUNCH_ID_OFFSET;
    mapping(bytes32 salt => bool used) public usedSalts;

    event EkuboDirectLaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        PoolId poolId,
        bytes32 positionId,
        uint32 tickSpacing,
        string name,
        string symbol,
        string contractURI
    );
    event EkuboDirectLaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 amount);
    event EkuboCreatorInitialBuy(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        uint256 nativeAmount,
        uint256 tokenAmount
    );

    constructor(
        address initialOwner,
        EkuboLiquidityLocker liquidityLocker_,
        BlueEkuboRouter swapRouter_,
        IFeePolicy feePolicy_,
        IRevenueRouter revenueRouter_
    ) Ownable(initialOwner) {
        if (
            address(liquidityLocker_) == address(0) || address(swapRouter_) == address(0)
                || address(feePolicy_) == address(0) || address(revenueRouter_) == address(0)
        ) revert InvalidLaunchConfig();
        liquidityLocker = liquidityLocker_;
        swapRouter = swapRouter_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
    }

    function launchFee() public view returns (uint256) {
        return feePolicy.launchFee();
    }

    function launchConfigHash() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(liquidityLocker),
                address(swapRouter),
                liquidityLocker.tickSpacing(),
                liquidityLocker.initialTick(),
                liquidityLocker.tickLower(),
                liquidityLocker.tickUpper()
            )
        );
    }

    function createLaunch(TokenMetadata calldata metadata, bytes32 expectedConfigHash, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address token, PoolId poolId, bytes32 positionId)
    {
        return _createLaunch(metadata, expectedConfigHash, deadline, 0, 0);
    }

    function createLaunchWithInitialBuy(
        TokenMetadata calldata metadata,
        bytes32 expectedConfigHash,
        uint256 deadline,
        uint128 minimumTokensOut
    ) external payable nonReentrant returns (uint256 launchId, address token, PoolId poolId, bytes32 positionId) {
        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value <= currentLaunchFee) revert InitialBuyFailed();
        return _createLaunch(metadata, expectedConfigHash, deadline, msg.value - currentLaunchFee, minimumTokensOut);
    }

    function _createLaunch(
        TokenMetadata calldata metadata,
        bytes32 expectedConfigHash,
        uint256 deadline,
        uint256 initialBuyAmount,
        uint128 minimumTokensOut
    ) private returns (uint256 launchId, address token, PoolId poolId, bytes32 positionId) {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (expectedConfigHash != launchConfigHash()) revert LaunchConfigChanged();
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40
                || bytes(metadata.symbol).length == 0 || bytes(metadata.symbol).length > 10
                || bytes(metadata.contractURI).length == 0
        ) revert InvalidMetadata();

        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, metadata.salt, "EKUBO"));
        if (usedSalts[effectiveSalt]) revert SaltAlreadyUsed();
        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value != currentLaunchFee + initialBuyAmount) revert InsufficientLaunchFee();

        usedSalts[effectiveSalt] = true;
        launchId = ++launchCount;
        token = _deployToken(metadata, effectiveSalt, MAX_SUPPLY, address(liquidityLocker));
        (positionId, poolId) = liquidityLocker.lockTokenOnlyLiquidity(
            launchId, token, MAX_SUPPLY, msg.sender
        );
        if (currentLaunchFee != 0) revenueRouter.depositLaunchRevenue{value: currentLaunchFee}();

        if (initialBuyAmount != 0) {
            if (initialBuyAmount > type(uint128).max) revert InitialBuyFailed();
            uint128 bought = swapRouter.buy{value: initialBuyAmount}(token, minimumTokensOut, msg.sender);
            if (bought == 0 || bought > MAX_INITIAL_BUY_TOKENS) revert InitialBuyExceedsFivePercent();
            emit EkuboCreatorInitialBuy(launchId, token, msg.sender, initialBuyAmount, bought);
        }

        emit EkuboDirectLaunchFeePaid(launchId, msg.sender, currentLaunchFee);
        emit EkuboDirectLaunchCreated(
            launchId,
            token,
            msg.sender,
            poolId,
            positionId,
            liquidityLocker.tickSpacing(),
            metadata.name,
            metadata.symbol,
            metadata.contractURI
        );
    }

    function _deployToken(
        TokenMetadata calldata metadata,
        bytes32 effectiveSalt,
        uint256 supply,
        address liquidityRecipient
    ) internal virtual returns (address token);
}
