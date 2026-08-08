// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.5.16;

import "contracts/UniswapV2Factory.sol";
import "contracts/UniswapV2Pair.sol";
import "contracts/test/ERC20.sol";

contract BlueSwapV2CoreTest {
    uint256 private constant ONE = 10 ** 18;
    uint256 private constant MINIMUM_LIQUIDITY = 10 ** 3;

    function testFactoryEnablesProtocolFeeAndTransfersControl() external {
        address feeTo = address(0xFEE);
        UniswapV2Factory factory = new UniswapV2Factory(address(this));
        factory.setFeeTo(feeTo);
        factory.setFeeToSetter(address(0xBEEF));

        require(factory.feeTo() == feeTo, "WRONG_FEE_TO");
        require(factory.feeToSetter() == address(0xBEEF), "WRONG_FEE_SETTER");
    }

    function testCanonicalProtocolFeeOnAccounting() external {
        address feeTo = address(0xFEE);
        UniswapV2Factory factory = new UniswapV2Factory(address(this));
        factory.setFeeTo(feeTo);
        ERC20 tokenA = new ERC20(10_000 * ONE);
        ERC20 tokenB = new ERC20(10_000 * ONE);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        UniswapV2Pair pair = UniswapV2Pair(pairAddress);
        ERC20 token0 = address(tokenA) < address(tokenB) ? tokenA : tokenB;
        ERC20 token1 = address(tokenA) < address(tokenB) ? tokenB : tokenA;

        token0.transfer(pairAddress, 1_000 * ONE);
        token1.transfer(pairAddress, 1_000 * ONE);
        pair.mint(address(this));

        token1.transfer(pairAddress, 1 * ONE);
        pair.swap(996006981039903216, 0, address(this), new bytes(0));

        pair.transfer(pairAddress, (1_000 * ONE) - MINIMUM_LIQUIDITY);
        pair.burn(address(this));

        require(pair.totalSupply() == MINIMUM_LIQUIDITY + 249750499251388, "WRONG_TOTAL_SUPPLY");
        require(pair.balanceOf(feeTo) == 249750499251388, "PROTOCOL_FEE_NOT_MINTED");
    }
}
