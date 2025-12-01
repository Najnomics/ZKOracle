// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Test } from "forge-std/src/Test.sol";
import { ZKOracle } from "../src/ZKOracle.sol";
import { FheEnabled } from "../util/FheHelper.sol";
import { IZKOracle } from "../src/interfaces/IZKOracle.sol";

contract MockConsumer {
    IZKOracle public immutable oracle;

    constructor(address _oracle) {
        oracle = IZKOracle(_oracle);
    }

    function latestFresh(uint256 maxAge) external view returns (uint256 price, uint32 sampleSize) {
        require(oracle.isFresh(maxAge), "STALE");
        (price,,, sampleSize) = oracle.getLatestPrice();
    }
}

contract ZKOracleIntegrationTest is Test, FheEnabled {
    ZKOracle internal oracle;
    MockConsumer internal consumer;

    address internal admin;
    address internal indexer;
    uint256 internal constant PERIOD = 30 minutes;
    uint32 internal constant MAX_SAMPLES = 32;
    uint256 internal constant SCALE = 1e4;

    function setUp() public {
        initializeFhe();
        admin = vm.addr(0xABCD);
        indexer = vm.addr(0xCAFE);
        oracle = new ZKOracle(indexer, PERIOD, MAX_SAMPLES, SCALE, admin);
        consumer = new MockConsumer(address(oracle));
    }

    function testEndToEndIndexerLoopFeedsConsumer() public {
        uint32[] memory samples = new uint32[](3);
        samples[0] = 100;
        samples[1] = 250;
        samples[2] = 150;

        for (uint256 i; i < samples.length; i++) {
            vm.prank(indexer);
            oracle.submitData(encrypt32(samples[i]));
        }

        vm.warp(block.timestamp + PERIOD + 5);
        vm.prank(indexer);
        oracle.finalizePeriod();

        (uint256 price, uint32 sampleSize) = consumer.latestFresh(1 days);
        uint256 expectedAverage = (samples[0] + samples[1] + samples[2]) / samples.length;
        assertEq(price, expectedAverage);
        assertEq(sampleSize, samples.length);
    }

    function testStaleDataRejectedByConsumer() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(400));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        vm.warp(block.timestamp + 3 days);

        vm.expectRevert("STALE");
        consumer.latestFresh(1 days);
    }
}

