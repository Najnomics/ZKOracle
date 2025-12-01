// SPDX-License-Identifier: MIT
pragma solidity >=0.8.25 <0.9.0;

import { BaseScript } from "./Base.s.sol";
import { ZKOracle } from "../src/ZKOracle.sol";

/// @dev Deploys the ZKOracle contract to the configured network.
contract Deploy is BaseScript {
    function run() public broadcast returns (ZKOracle oracle) {
        address admin = vm.envOr({ name: "ORACLE_ADMIN", defaultValue: broadcaster });
        address indexer = vm.envOr({ name: "ORACLE_INDEXER", defaultValue: broadcaster });
        uint256 periodDuration = vm.envOr({ name: "ORACLE_PERIOD", defaultValue: uint256(1 hours) });
        uint32 maxSamples = vm.envOr({ name: "ORACLE_MAX_SAMPLES", defaultValue: uint32(256) });
        uint256 submissionScale = vm.envOr({ name: "ORACLE_SUBMISSION_SCALE", defaultValue: uint256(1e4) });

        oracle = new ZKOracle(indexer, periodDuration, maxSamples, submissionScale, admin);
    }
}
