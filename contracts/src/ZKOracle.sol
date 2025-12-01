// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { FHE, euint32, inEuint32 } from "@fhenixprotocol/contracts/FHE.sol";

/**
 * @title ZKOracle
 * @notice Aggregates encrypted Zcash-derived metrics using Fhenix FHE primitives.
 *         Inspired by the architecture described in README.md and ZCASH_ECOSYSTEM_STUDY.md.
 */
contract ZKOracle is Ownable {
    using FHE for euint32;

    /*//////////////////////////////////////////////////////////////
                               ERRORS
    //////////////////////////////////////////////////////////////*/

    error OracleUnauthorized();
    error OraclePeriodActive();
    error OraclePeriodNotFinished();
    error OracleNoSamples();
    error OracleNotReady();
    error OracleZeroAddress();
    error OracleSubmissionsPaused();
    error OracleMaxSamplesReached();
    error OracleInvalidParameter();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event DataSubmitted(uint256 indexed periodStart, address indexed submitter, uint32 sampleSize);
    event PricePublished(uint256 price, uint256 confidence, uint32 sampleSize, uint256 timestamp);
    event IndexerUpdated(address indexed newIndexer);
    event PeriodDurationUpdated(uint256 newDuration);
    event MaxSamplesUpdated(uint32 newMax);
    event SubmissionPauseSet(bool paused);

    /*//////////////////////////////////////////////////////////////
                             STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    address public indexer;

    uint256 public periodStart;
    uint256 public periodDuration;
    uint32 public maxSamplesPerPeriod;
    bool public submissionsPaused;

    /// @dev Scaling factor applied by the indexer before encryption (e.g., 1e4 for 4 decimals).
    uint256 public immutable submissionScale;

    euint32 private encryptedSum;
    euint32 private encryptedCount;
    euint32 private lastEncryptedAverage;

    uint32 public currentSampleSize;

    uint256 public latestPrice;
    uint256 public lastUpdate;
    uint256 public confidence;
    uint32 public latestSampleSize;

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address _indexer,
        uint256 _periodDuration,
        uint32 _maxSamplesPerPeriod,
        uint256 _submissionScale,
        address admin
    )
        Ownable(admin)
    {
        if (_indexer == address(0)) revert OracleZeroAddress();
        if (_periodDuration == 0) revert OraclePeriodActive();
        if (_maxSamplesPerPeriod == 0) revert OracleInvalidParameter();
        if (_submissionScale == 0) revert OracleInvalidParameter();

        indexer = _indexer;
        periodDuration = _periodDuration;
        maxSamplesPerPeriod = _maxSamplesPerPeriod;
        submissionScale = _submissionScale;

        periodStart = block.timestamp;
        encryptedSum = FHE.asEuint32(0);
        encryptedCount = FHE.asEuint32(0);
    }

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyIndexer() {
        if (msg.sender != indexer) revert OracleUnauthorized();
        _;
    }

    modifier onlyAuthorizedFinalizer() {
        if (msg.sender != indexer && msg.sender != owner()) revert OracleUnauthorized();
        _;
    }

    modifier duringPeriod() {
        if (block.timestamp >= periodStart + periodDuration) revert OraclePeriodNotFinished();
        _;
    }

    modifier afterPeriod() {
        if (block.timestamp < periodStart + periodDuration) revert OraclePeriodActive();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                               MAIN LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Submit an encrypted estimate derived from shielded Zcash data.
     * @dev Only callable by the authorized indexer while the collection window is active.
     */
    function submitData(inEuint32 calldata encryptedAmount) external onlyIndexer duringPeriod {
        if (submissionsPaused) revert OracleSubmissionsPaused();
        if (currentSampleSize >= maxSamplesPerPeriod) revert OracleMaxSamplesReached();

        euint32 amount = FHE.asEuint32(encryptedAmount);

        encryptedSum = encryptedSum + amount;
        encryptedCount = encryptedCount + FHE.asEuint32(1);
        currentSampleSize += 1;

        emit DataSubmitted(periodStart, msg.sender, currentSampleSize);
    }

    /**
     * @notice Finalize the period, decrypt the aggregate, and reset for the next window.
     * @dev Decrypts only the aggregate average and sample size, preserving individual privacy.
     */
    function finalizePeriod() external onlyAuthorizedFinalizer afterPeriod {
        if (currentSampleSize == 0) revert OracleNoSamples();

        // Average = sum / count (all encrypted).
        euint32 avgEncrypted = encryptedSum / encryptedCount;
        lastEncryptedAverage = avgEncrypted;

        uint256 avgPlain = FHE.decrypt(avgEncrypted);
        latestPrice = avgPlain;
        lastUpdate = block.timestamp;

        latestSampleSize = currentSampleSize;
        confidence = _deriveConfidence(currentSampleSize);

        emit PricePublished(latestPrice, confidence, latestSampleSize, block.timestamp);

        _resetPeriodState();
    }

    /**
     * @notice Returns the latest decrypted price, timestamp, confidence, and sample size.
     */
    function getLatestPrice()
        external
        view
        returns (uint256 price, uint256 timestamp, uint256 conf, uint32 sampleSize)
    {
        return (latestPrice, lastUpdate, confidence, latestSampleSize);
    }

    /**
     * @notice Returns true if the latest published price is younger than `maxAge`.
     */
    function isFresh(uint256 maxAge) external view returns (bool) {
        if (lastUpdate == 0) return false;
        return block.timestamp - lastUpdate <= maxAge;
    }

    /**
     * @notice Seal the latest encrypted average for a consumer public key.
     * @dev Useful for downstream contracts that want a sealed ciphertext instead of plaintext.
     */
    function sealLatestPrice(bytes32 consumerPublicKey) external view returns (string memory) {
        if (!FHE.isInitialized(lastEncryptedAverage)) revert OracleNotReady();
        return FHE.sealoutput(lastEncryptedAverage, consumerPublicKey);
    }

    /*//////////////////////////////////////////////////////////////
                               ADMIN
    //////////////////////////////////////////////////////////////*/

    function updateIndexer(address newIndexer) external onlyOwner {
        if (newIndexer == address(0)) revert OracleZeroAddress();
        indexer = newIndexer;
        emit IndexerUpdated(newIndexer);
    }

    function updatePeriodDuration(uint256 newDuration) external onlyOwner {
        if (newDuration == 0) revert OraclePeriodActive();
        periodDuration = newDuration;
        emit PeriodDurationUpdated(newDuration);
    }

    function updateMaxSamples(uint32 newMax) external onlyOwner {
        if (newMax == 0) revert OracleInvalidParameter();
        maxSamplesPerPeriod = newMax;
        emit MaxSamplesUpdated(newMax);
    }

    function setSubmissionsPaused(bool paused) external onlyOwner {
        submissionsPaused = paused;
        emit SubmissionPauseSet(paused);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _deriveConfidence(uint32 sampleSize) internal pure returns (uint256) {
        if (sampleSize >= 100) return 90;
        if (sampleSize >= 50) return 80;
        if (sampleSize >= 25) return 70;
        if (sampleSize >= 10) return 60;
        return 40;
    }

    function _resetPeriodState() internal {
        encryptedSum = FHE.asEuint32(0);
        encryptedCount = FHE.asEuint32(0);
        currentSampleSize = 0;
        periodStart = block.timestamp;
    }
}

