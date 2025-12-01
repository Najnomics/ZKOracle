// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Test } from "forge-std/src/Test.sol";
import { ZKOracle } from "../src/ZKOracle.sol";
import { FheEnabled } from "../util/FheHelper.sol";

contract ZKOracleTest is Test, FheEnabled {
    ZKOracle internal oracle;

    address internal admin;
    address internal indexer;
    uint256 internal constant PERIOD = 1 hours;
    uint32 internal constant MAX_SAMPLES = 16;
    uint256 internal constant SCALE = 1e4;

    function setUp() public {
        initializeFhe();
        admin = vm.addr(0xA11CE);
        indexer = vm.addr(0xBEEF);
        oracle = new ZKOracle(indexer, PERIOD, MAX_SAMPLES, SCALE, admin);
    }

    function testSubmitAndFinalizeComputesAverage() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(10));

        vm.prank(indexer);
        oracle.submitData(encrypt32(30));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        (uint256 price, uint256 timestamp, uint256 confidence, uint32 sampleSize) = oracle.getLatestPrice();
        assertEq(price, 20);
        assertGt(timestamp, 0);
        assertGt(confidence, 0);
        assertEq(sampleSize, 2);
        assertEq(oracle.currentSampleSize(), 0);
    }

    function testSealLatestPriceReturnsCiphertext() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(42));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        string memory ciphertext = oracle.sealLatestPrice(bytes32(uint256(123)));
        assertGt(bytes(ciphertext).length, 0);
    }

    function testSubmitRevertsForUnauthorizedSender() public {
        vm.expectRevert(ZKOracle.OracleUnauthorized.selector);
        oracle.submitData(encrypt32(1));
    }

    function testFinalizeRevertsIfPeriodNotEnded() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(5));

        vm.prank(indexer);
        vm.expectRevert(ZKOracle.OraclePeriodActive.selector);
        oracle.finalizePeriod();
    }

    function testFinalizeRevertsIfNoSamples() public {
        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        vm.expectRevert(ZKOracle.OracleNoSamples.selector);
        oracle.finalizePeriod();
    }

    function testOwnerCanUpdateIndexer() public {
        vm.prank(admin);
        oracle.updateIndexer(address(0x1234));
        assertEq(oracle.indexer(), address(0x1234));
    }

    function testOwnerCanPauseSubmissions() public {
        vm.prank(admin);
        oracle.setSubmissionsPaused(true);

        vm.prank(indexer);
        vm.expectRevert(ZKOracle.OracleSubmissionsPaused.selector);
        oracle.submitData(encrypt32(1));
    }

    function testMaxSamplesGuard() public {
        vm.prank(admin);
        oracle.updateMaxSamples(1);

        vm.prank(indexer);
        oracle.submitData(encrypt32(5));

        vm.prank(indexer);
        vm.expectRevert(ZKOracle.OracleMaxSamplesReached.selector);
        oracle.submitData(encrypt32(5));
    }

    function testOwnerCanFinalizeWhenIndexerUnavailable() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(77));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(admin);
        oracle.finalizePeriod();

        (uint256 price,,,) = oracle.getLatestPrice();
        assertEq(price, 77);
    }

    function testSealLatestPriceRevertsIfNotReady() public {
        vm.expectRevert(ZKOracle.OracleNotReady.selector);
        oracle.sealLatestPrice(bytes32(uint256(1)));
    }

    function testPeriodResetsAfterFinalize() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(12));
        uint256 startBefore = oracle.periodStart();

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        assertEq(oracle.currentSampleSize(), 0);
        assertGt(oracle.periodStart(), startBefore);
    }

    function testIsFreshChecksStalenessWindow() public {
        vm.prank(indexer);
        oracle.submitData(encrypt32(33));

        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(indexer);
        oracle.finalizePeriod();

        assertTrue(oracle.isFresh(2 hours));

        vm.warp(block.timestamp + 3 hours);
        assertFalse(oracle.isFresh(1 hours));
    }

    function testMultiPeriodCycleMaintainsState() public {
        uint32 base = 20;
        for (uint256 i; i < 3; i++) {
            vm.prank(indexer);
            oracle.submitData(encrypt32(base + uint32(i)));

            vm.warp(block.timestamp + PERIOD + 1);
            vm.prank(indexer);
            oracle.finalizePeriod();

            (uint256 price,, uint256 conf, uint32 sampleSize) = oracle.getLatestPrice();
            assertEq(price, base + i);
            assertEq(sampleSize, 1);
            assertGt(conf, 0);
        }
    }

    function testUpdatePeriodDurationRejectsZero() public {
        vm.prank(admin);
        vm.expectRevert(ZKOracle.OraclePeriodActive.selector);
        oracle.updatePeriodDuration(0);
    }
}

