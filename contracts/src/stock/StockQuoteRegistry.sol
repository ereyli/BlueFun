// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TwoStepAdmin} from "../access/TwoStepAdmin.sol";

interface IStockPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IPausableStockOracle {
    function oraclePaused() external view returns (bool);
}

interface ITransferPausableStock {
    function isPaused(uint8 feature) external view returns (bool);
}

/// @notice Canonical allowlist for stock tokens that may quote BlueFun launches on one chain.
/// @dev Admin is intended to be the existing BlueFun timelock/Safe. Offchain discovery never activates an asset.
contract StockQuoteRegistry is TwoStepAdmin {
    error InvalidAddress();
    error InvalidAsset();
    error InvalidOracleAnswer();
    error StaleOracleAnswer();
    error OraclePaused();
    error InvalidPriceProof();

    uint256 private constant WAD = 1e18;
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct QuoteAsset {
        address priceFeed;
        uint32 maxStaleness;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        bool checkOraclePause;
        bool checkTransferPause;
        bool useAttestedPrice;
        bool enabled;
        bytes32 ticker;
    }

    struct AssetConfig {
        address token;
        address priceFeed;
        bytes32 ticker;
        uint32 maxStaleness;
        uint8 tokenDecimals;
        bool checkOraclePause;
        bool checkTransferPause;
        bool useAttestedPrice;
        bool enabled;
    }

    address public priceSigner;

    mapping(address token => QuoteAsset asset) private _assets;
    address[] private _tokens;
    mapping(address token => bool known) private _known;

    event QuoteAssetConfigured(
        address indexed token,
        address indexed priceFeed,
        bytes32 indexed ticker,
        uint32 maxStaleness,
        uint8 tokenDecimals,
        uint8 feedDecimals,
        bool checkOraclePause,
        bool checkTransferPause,
        bool useAttestedPrice,
        bool enabled
    );
    event PriceSignerUpdated(address indexed previousSigner, address indexed newSigner);

    constructor(address initialAdmin, address initialPriceSigner) TwoStepAdmin(initialAdmin) {
        if (initialPriceSigner == address(0)) revert InvalidAddress();
        priceSigner = initialPriceSigner;
        emit PriceSignerUpdated(address(0), initialPriceSigner);
    }

    function configureAsset(
        address token,
        address priceFeed,
        bytes32 ticker,
        uint32 maxStaleness,
        uint8 tokenDecimals,
        bool checkOraclePause,
        bool checkTransferPause,
        bool useAttestedPrice,
        bool enabled
    ) public onlyAdmin {
        if (token == address(0)) {
            revert InvalidAddress();
        }
        if (ticker == bytes32(0) || maxStaleness < 1 hours || tokenDecimals != 18) revert InvalidAsset();
        uint8 feedDecimals;
        if (useAttestedPrice) {
            if (priceFeed != address(0) || checkOraclePause || checkTransferPause) revert InvalidAsset();
        } else {
            if (priceFeed == address(0) || priceFeed.code.length == 0) revert InvalidAddress();
            feedDecimals = IStockPriceFeed(priceFeed).decimals();
            if (feedDecimals == 0 || feedDecimals > 18) revert InvalidAsset();
        }
        if (checkOraclePause && checkTransferPause) revert InvalidAsset();
        if (!_known[token]) {
            _known[token] = true;
            _tokens.push(token);
        }
        _assets[token] = QuoteAsset({
            priceFeed: priceFeed,
            maxStaleness: maxStaleness,
            tokenDecimals: tokenDecimals,
            feedDecimals: feedDecimals,
            checkOraclePause: checkOraclePause,
            checkTransferPause: checkTransferPause,
            useAttestedPrice: useAttestedPrice,
            enabled: enabled,
            ticker: ticker
        });
        emit QuoteAssetConfigured(
            token,
            priceFeed,
            ticker,
            maxStaleness,
            tokenDecimals,
            feedDecimals,
            checkOraclePause,
            checkTransferPause,
            useAttestedPrice,
            enabled
        );
    }

    function configureAssets(AssetConfig[] calldata configs) external onlyAdmin {
        uint256 length = configs.length;
        if (length == 0) revert InvalidAsset();
        for (uint256 i; i < length; ++i) {
            AssetConfig calldata config = configs[i];
            configureAsset(
                config.token,
                config.priceFeed,
                config.ticker,
                config.maxStaleness,
                config.tokenDecimals,
                config.checkOraclePause,
                config.checkTransferPause,
                config.useAttestedPrice,
                config.enabled
            );
        }
    }

    function disableAsset(address token) external onlyAdmin {
        QuoteAsset storage quoteAsset = _assets[token];
        if (!_known[token]) revert InvalidAsset();
        quoteAsset.enabled = false;
        emit QuoteAssetConfigured(
            token,
            quoteAsset.priceFeed,
            quoteAsset.ticker,
            quoteAsset.maxStaleness,
            quoteAsset.tokenDecimals,
            quoteAsset.feedDecimals,
            quoteAsset.checkOraclePause,
            quoteAsset.checkTransferPause,
            quoteAsset.useAttestedPrice,
            false
        );
    }

    function setPriceSigner(address newSigner) external onlyAdmin {
        if (newSigner == address(0) || newSigner == priceSigner) revert InvalidAddress();
        emit PriceSignerUpdated(priceSigner, newSigner);
        priceSigner = newSigner;
    }

    function asset(address token) external view returns (QuoteAsset memory) {
        return _assets[token];
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    function isEnabled(address token) external view returns (bool) {
        return _assets[token].enabled;
    }

    /// @return price18 Stock price multiplied by the corporate-action multiplier, normalized to 18 decimals.
    function validatedPrice18(address token) public view returns (uint256 price18) {
        QuoteAsset memory quote = _assets[token];
        if (!quote.enabled || quote.useAttestedPrice) revert InvalidAsset();
        if (quote.checkOraclePause && IPausableStockOracle(token).oraclePaused()) revert OraclePaused();
        if (quote.checkTransferPause && ITransferPausableStock(token).isPaused(0)) revert OraclePaused();
        (, int256 answer,, uint256 updatedAt,) = IStockPriceFeed(quote.priceFeed).latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidOracleAnswer();
        if (block.timestamp - updatedAt > quote.maxStaleness) revert StaleOracleAnswer();
        price18 = uint256(answer) * (WAD / (10 ** quote.feedDecimals));
    }

    function validatedPrice18(address token, uint256 attestedPrice18, uint64 validUntil, bytes calldata signature)
        public
        view
        returns (uint256 price18)
    {
        QuoteAsset memory quote = _assets[token];
        if (!quote.enabled) revert InvalidAsset();
        if (!quote.useAttestedPrice) return validatedPrice18(token);
        if (
            attestedPrice18 == 0 || validUntil < block.timestamp || validUntil > block.timestamp + 5 minutes
                || signature.length != 65
        ) revert InvalidPriceProof();
        bytes32 payload = keccak256(
            abi.encode(
                "BLUEFUN_STOCK_OPENING_PRICE_V1", block.chainid, address(this), token, attestedPrice18, validUntil
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payload));
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) revert InvalidPriceProof();
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != priceSigner) revert InvalidPriceProof();
        return attestedPrice18;
    }
}
