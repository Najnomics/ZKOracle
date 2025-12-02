// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IZKOracle } from "./interfaces/IZKOracle.sol";

/**
 * @title OracleConsumer
 * @notice Reference consumer contract that reads from `ZKOracle` and enforces freshness/confidence thresholds.
 */
contract OracleConsumer is Ownable {
    error ConsumerZeroAddress();
    error ConsumerInvalidConfig();
    error ConsumerStale();
    error ConsumerLowConfidence();

    IZKOracle public immutable ORACLE;

    uint256 public freshnessThreshold;
    uint256 public minConfidence;

    struct PriceInfo {
        uint256 price;
        uint32 sampleSize;
        uint256 updatedAt;
        uint256 confidence;
    }

    constructor(
        address oracleAddress,
        uint256 _freshnessThreshold,
        uint256 _minConfidence,
        address admin
    )
        Ownable(admin)
    {
        if (oracleAddress == address(0)) revert ConsumerZeroAddress();
        if (_freshnessThreshold == 0 || _minConfidence == 0 || _minConfidence > 100) {
            revert ConsumerInvalidConfig();
        }
        ORACLE = IZKOracle(oracleAddress);
        freshnessThreshold = _freshnessThreshold;
        minConfidence = _minConfidence;
    }

    function updateConfig(uint256 newFreshnessThreshold, uint256 newMinConfidence) external onlyOwner {
        if (newFreshnessThreshold == 0 || newMinConfidence == 0 || newMinConfidence > 100) {
            revert ConsumerInvalidConfig();
        }
        freshnessThreshold = newFreshnessThreshold;
        minConfidence = newMinConfidence;
    }

    function latestPrice() public view returns (PriceInfo memory info) {
        (uint256 price, uint256 timestamp, uint256 confidence, uint32 sampleSize) = ORACLE.getLatestPrice();
        if (timestamp == 0 || block.timestamp - timestamp > freshnessThreshold) revert ConsumerStale();
        if (confidence < minConfidence) revert ConsumerLowConfidence();
        return PriceInfo({ price: price, sampleSize: sampleSize, updatedAt: timestamp, confidence: confidence });
    }

    function quote(uint256 amount) external view returns (uint256) {
        PriceInfo memory info = latestPrice();
        return (amount * info.price) / 1e4; // assumes oracle prices scaled by 4 decimals
    }
}

