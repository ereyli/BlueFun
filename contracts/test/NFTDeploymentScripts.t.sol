// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {DeployNFTLaunchpadV3BaseMainnet} from "../script/DeployNFTLaunchpadV3BaseMainnet.s.sol";
import {DeployNFTLaunchpadV4BaseMainnet} from "../script/DeployNFTLaunchpadV4BaseMainnet.s.sol";

contract NFTDeploymentScriptsTest is Test {
    function testV3DeploymentRejectsNonBaseNetwork() public {
        DeployNFTLaunchpadV3BaseMainnet script = new DeployNFTLaunchpadV3BaseMainnet();
        vm.expectRevert();
        script.run();
    }

    function testV4DeploymentRejectsNonBaseNetwork() public {
        DeployNFTLaunchpadV4BaseMainnet script = new DeployNFTLaunchpadV4BaseMainnet();
        vm.expectRevert();
        script.run();
    }
}
