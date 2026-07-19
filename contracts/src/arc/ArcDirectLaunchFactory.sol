// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {StandardLaunchToken} from "../StandardLaunchToken.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {IFeePolicy} from "../interfaces/IFeePolicy.sol";
import {IRevenueRouter} from "../interfaces/IRevenueRouter.sol";
import {ArcDexAdapterRegistry} from "./ArcDexAdapterRegistry.sol";
import {IArcDirectDexAdapter} from "./IArcDexAdapter.sol";

/// @notice Arc Direct launch factory activated only after its DEX adapter is frozen.
contract ArcDirectLaunchFactory is ReentrancyGuard {
    error InvalidLaunchConfig();
    error InvalidMetadata();
    error InsufficientLaunchFee();
    error SaltAlreadyUsed();
    error DeadlineExpired();
    error LaunchesPaused();
    error AdapterNotFrozen();
    error AdapterNotReady();
    error InitialBuyExceedsFivePercent();
    error UnexpectedInitialBuyOutput();
    error AdapterOutputMismatch();

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_INITIAL_BUY_TOKENS = MAX_SUPPLY / 20;

    struct TokenMetadata {
        string name;
        string symbol;
        string contractURI;
        bytes32 salt;
    }

    ArcDexAdapterRegistry public immutable adapterRegistry;
    IFeePolicy public immutable feePolicy;
    IRevenueRouter public immutable revenueRouter;
    uint256 public launchCount;
    mapping(bytes32 effectiveSalt => bool used) public usedSalts;

    event ArcDirectLaunchCreated(
        uint256 indexed launchId,
        address indexed token,
        address indexed creator,
        address adapter,
        bytes32 poolId,
        bytes32 positionId,
        bytes32 configHash,
        string name,
        string symbol,
        string contractURI
    );
    event ArcDirectLaunchFeePaid(uint256 indexed launchId, address indexed creator, uint256 usdcAmount);
    event ArcDirectCreatorInitialBuy(
        uint256 indexed launchId, address indexed creator, uint256 usdcAmount, uint256 tokenAmount
    );

    constructor(ArcDexAdapterRegistry adapterRegistry_, IFeePolicy feePolicy_, IRevenueRouter revenueRouter_) {
        if (
            address(adapterRegistry_) == address(0) || address(feePolicy_) == address(0)
                || address(revenueRouter_) == address(0)
        ) revert InvalidLaunchConfig();
        adapterRegistry = adapterRegistry_;
        feePolicy = feePolicy_;
        revenueRouter = revenueRouter_;
    }

    function launchFee() external view returns (uint256) {
        return feePolicy.launchFee();
    }

    function predictTokenAddress(address creator, TokenMetadata calldata metadata) external view returns (address) {
        address adapter = adapterRegistry.directAdapter();
        if (adapter == address(0)) revert AdapterNotReady();
        bytes32 effectiveSalt = keccak256(abi.encode(creator, block.chainid, metadata.salt));
        bytes memory init = abi.encodePacked(
            type(StandardLaunchToken).creationCode,
            abi.encode(metadata.name, metadata.symbol, metadata.contractURI, adapter, MAX_SUPPLY)
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), effectiveSalt, keccak256(init)))))
        );
    }

    function createLaunch(TokenMetadata calldata metadata, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId)
    {
        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value != currentLaunchFee) revert InsufficientLaunchFee();
        return _createLaunch(metadata, deadline, 0, 0);
    }

    function createLaunchWithInitialBuy(TokenMetadata calldata metadata, uint256 deadline, uint256 minimumTokensOut)
        external
        payable
        nonReentrant
        returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId)
    {
        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value <= currentLaunchFee) revert InsufficientLaunchFee();
        return _createLaunch(metadata, deadline, msg.value - currentLaunchFee, minimumTokensOut);
    }

    function _createLaunch(
        TokenMetadata calldata metadata,
        uint256 deadline,
        uint256 initialBuyUsdc,
        uint256 minimumTokensOut
    ) private returns (uint256 launchId, address token, bytes32 poolId, bytes32 positionId) {
        if (feePolicy.newLaunchesPaused()) revert LaunchesPaused();
        if (!adapterRegistry.directAdapterFrozen()) revert AdapterNotFrozen();
        if (block.timestamp > deadline) revert DeadlineExpired();
        _validateMetadata(metadata);

        address adapterAddress = adapterRegistry.directAdapter();
        IArcDirectDexAdapter adapter = IArcDirectDexAdapter(adapterAddress);
        if (!adapter.isReady()) revert AdapterNotReady();

        uint256 currentLaunchFee = feePolicy.launchFee();
        if (msg.value != currentLaunchFee + initialBuyUsdc) revert InsufficientLaunchFee();
        if (initialBuyUsdc == 0 && minimumTokensOut != 0) revert UnexpectedInitialBuyOutput();

        bytes32 effectiveSalt = keccak256(abi.encode(msg.sender, block.chainid, metadata.salt));
        if (usedSalts[effectiveSalt]) revert SaltAlreadyUsed();
        usedSalts[effectiveSalt] = true;
        launchId = ++launchCount;
        token = address(
            new StandardLaunchToken{salt: effectiveSalt}(
                metadata.name, metadata.symbol, metadata.contractURI, adapterAddress, MAX_SUPPLY
            )
        );

        uint256 reportedTokensOut;
        (poolId, positionId, reportedTokensOut) = adapter.createDirectLaunch{value: initialBuyUsdc}(
            launchId, token, MAX_SUPPLY, msg.sender, adapterRegistry.directConfigHash(), minimumTokensOut
        );
        uint256 tokensOut = StandardLaunchToken(token).balanceOf(msg.sender);
        if (reportedTokensOut != tokensOut) revert AdapterOutputMismatch();
        if (poolId == bytes32(0) || positionId == bytes32(0)) revert AdapterNotReady();
        if (tokensOut > MAX_INITIAL_BUY_TOKENS) revert InitialBuyExceedsFivePercent();
        if (initialBuyUsdc == 0 && tokensOut != 0) revert UnexpectedInitialBuyOutput();

        if (currentLaunchFee != 0) revenueRouter.depositLaunchRevenue{value: currentLaunchFee}();
        emit ArcDirectLaunchFeePaid(launchId, msg.sender, currentLaunchFee);
        if (initialBuyUsdc != 0) {
            if (tokensOut < minimumTokensOut || tokensOut == 0) revert UnexpectedInitialBuyOutput();
            emit ArcDirectCreatorInitialBuy(launchId, msg.sender, initialBuyUsdc, tokensOut);
        }
        emit ArcDirectLaunchCreated(
            launchId,
            token,
            msg.sender,
            adapterAddress,
            poolId,
            positionId,
            adapterRegistry.directConfigHash(),
            metadata.name,
            metadata.symbol,
            metadata.contractURI
        );
    }

    function _validateMetadata(TokenMetadata calldata metadata) private pure {
        if (
            bytes(metadata.name).length == 0 || bytes(metadata.name).length > 40 || bytes(metadata.symbol).length == 0
                || bytes(metadata.symbol).length > 10 || bytes(metadata.contractURI).length == 0
                || bytes(metadata.contractURI).length > 512
        ) revert InvalidMetadata();
    }
}
