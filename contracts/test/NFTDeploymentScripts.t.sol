// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "./utils/Test.sol";
import {DeployNFTLaunchpadBaseMainnet} from "../script/DeployNFTLaunchpadBaseMainnet.s.sol";
import {DeployNFTLaunchpadV2BaseMainnet} from "../script/DeployNFTLaunchpadV2BaseMainnet.s.sol";
import {DeployNFTPFPBaseMainnet} from "../script/DeployNFTPFPBaseMainnet.s.sol";
import {DeployNFTOffersBaseMainnet} from "../script/DeployNFTOffersBaseMainnet.s.sol";
import {DeployNFTLaunchpadV3BaseMainnet} from "../script/DeployNFTLaunchpadV3BaseMainnet.s.sol";

contract NFTDeploymentScriptsTest is Test {
    function testLegacyLaunchpadDeploymentIsDisabled() public {
        DeployNFTLaunchpadBaseMainnet script = new DeployNFTLaunchpadBaseMainnet();
        vm.expectRevert(DeployNFTLaunchpadBaseMainnet.DeprecatedDeploymentScript.selector);
        script.run();
    }

    function testLegacyV2DeploymentIsDisabled() public {
        DeployNFTLaunchpadV2BaseMainnet script = new DeployNFTLaunchpadV2BaseMainnet();
        vm.expectRevert(DeployNFTLaunchpadV2BaseMainnet.DeprecatedDeploymentScript.selector);
        script.run();
    }

    function testLegacyPFPDeploymentIsDisabled() public {
        DeployNFTPFPBaseMainnet script = new DeployNFTPFPBaseMainnet();
        vm.expectRevert(DeployNFTPFPBaseMainnet.DeprecatedDeploymentScript.selector);
        script.run();
    }

    function testLegacyOfferDeploymentIsDisabled() public {
        DeployNFTOffersBaseMainnet script = new DeployNFTOffersBaseMainnet();
        vm.expectRevert(DeployNFTOffersBaseMainnet.DeprecatedDeploymentScript.selector);
        script.run();
    }

    function testV3DeploymentRejectsNonBaseNetwork() public {
        DeployNFTLaunchpadV3BaseMainnet script = new DeployNFTLaunchpadV3BaseMainnet();
        vm.expectRevert();
        script.run();
    }
}
