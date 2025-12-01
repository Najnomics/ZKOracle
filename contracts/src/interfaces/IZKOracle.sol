// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IZKOracle {
    function getLatestPrice()
        external
        view
        returns (uint256 price, uint256 timestamp, uint256 confidence, uint32 sampleSize);

    function isFresh(uint256 maxAge) external view returns (bool);
}

