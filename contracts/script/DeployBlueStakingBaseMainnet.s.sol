// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {BlueRevenueRouter} from "../src/BlueRevenueRouter.sol";
import {BlueStakingVault} from "../src/BlueStakingVault.sol";
import {StakingTimelock} from "../src/StakingTimelock.sol";

interface VmBlueStakingBase {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployBlueStakingBaseMainnet {
    VmBlueStakingBase internal constant vm =
        VmBlueStakingBase(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant BLUE = 0xb200000000000000000000Af2d07754b927109bc;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    uint64 internal constant ADMIN_DELAY = 7 days;
    uint64 internal constant REWARDS_DURATION = 7 days;
    uint64 internal constant COOLDOWN_DURATION = 30 days;
    uint16 internal constant STAKING_SHARE_BPS = 5_000;

    event BlueStakingDeployed(
        address indexed governance,
        address indexed revenueRouter,
        address indexed stakingVault,
        address blue,
        address weth,
        address treasury,
        address revenueOperator,
        address guardian
    );

    function run() external {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        address adminOwner = vm.envAddress("STAKING_ADMIN_OWNER");
        address guardian = vm.envAddress("STAKING_GUARDIAN");
        address treasury = vm.envAddress("STAKING_TREASURY");
        address revenueOperator = vm.envAddress("STAKING_REVENUE_OPERATOR");
        require(deployer != address(0), "INVALID_DEPLOYER");
        require(adminOwner != guardian, "OWNER_GUARDIAN_MUST_DIFFER");

        vm.startBroadcast(privateKey);
        StakingTimelock governance = new StakingTimelock(adminOwner, guardian, ADMIN_DELAY);
        BlueRevenueRouter router = new BlueRevenueRouter(
            BLUE,
            WETH,
            address(governance),
            guardian,
            treasury,
            revenueOperator,
            STAKING_SHARE_BPS,
            REWARDS_DURATION,
            COOLDOWN_DURATION
        );
        vm.stopBroadcast();

        emit BlueStakingDeployed(
            address(governance),
            address(router),
            address(router.vault()),
            BLUE,
            WETH,
            treasury,
            revenueOperator,
            guardian
        );
    }
}
