// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Test } from "forge-std/src/Test.sol";
import { ZKOracle } from "../src/ZKOracle.sol";
import { FheEnabled } from "../util/FheHelper.sol";
import { OracleConsumer } from "../src/OracleConsumer.sol";

contract ZKOracleIntegrationTest is Test, FheEnabled {
    ZKOracle internal oracle;
    OracleConsumer internal consumer;

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
        consumer = new OracleConsumer(address(oracle), 1 days, 35, admin);
    }

    function testEndToEndIndexerLoopFeedsConsumer() public {
        uint32[] memory samples = new uint32[](3);
        samples[0] = 100_000;
        samples[1] = 250_000;
        samples[2] = 150_000;

        for (uint256 i; i < samples.length; i++) {
            vm.prank(indexer);
            oracle.submitData(encrypt32(samples[i]));
        }

        vm.warp(block.timestamp + PERIOD + 5);
        vm.prank(indexer);
        oracle.finalizePeriod();

        OracleConsumer.PriceInfo memory info = consumer.latestPrice();
        uint256 expectedAverage = (samples[0] + samples[1] + samples[2]) / samples.length;
        assertEq(info.price, expectedAverage);
        assertEq(info.sampleSize, samples.length);

        uint256 quoteAmount = consumer.quote(20_000); // 2.0 units (scaled by 1e4)
        assertEq(quoteAmount, (expectedAverage * 20_000) / 1e4);
    }

    function testStaleDataRejectedByConsumer() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(400_000));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(OracleConsumer.ConsumerStale.selector);
        consumer.latestPrice();
    }

    function testConsumerRejectsLowConfidence() public {
        OracleConsumer strictConsumer = new OracleConsumer(address(oracle), 1 days, 95, admin);

        vm.prank(indexer);
        oracle.submitData(encrypt32(50_000));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        vm.expectRevert(OracleConsumer.ConsumerLowConfidence.selector);
        strictConsumer.latestPrice();
    }
}

