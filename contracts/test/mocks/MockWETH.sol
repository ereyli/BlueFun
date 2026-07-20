// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract MockWETH {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address from, address recipient, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount || balanceOf[from] < amount) return false;
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}
