import { describe, expect, it, beforeEach } from "vitest";
import { computeShieldedEstimate, resetEstimatorState } from "./estimator.js";
import type { ShieldedTxMetadata } from "./clients/lightwalletd.js";

const makeTx = (time: number, pool: ShieldedTxMetadata["pool"]): ShieldedTxMetadata => ({
  txid: `test-${time}-${pool}`,
  blockTime: time,
  pool,
});

describe("computeShieldedEstimate", () => {
  beforeEach(() => {
    resetEstimatorState();
  });

  it("returns positive values with confidence for sapling pool", () => {
    const result = computeShieldedEstimate(makeTx(1_700_000_000, "sapling"));
    expect(result.amount).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("applies pool bias for orchard", () => {
    const sapling = computeShieldedEstimate(makeTx(1_700_000_000, "sapling"));
    const orchard = computeShieldedEstimate(makeTx(1_700_000_100, "orchard"));
    expect(orchard.amount).toBeGreaterThan(sapling.amount);
  });

  it("boosts estimates during rapid activity", () => {
    computeShieldedEstimate(makeTx(1_700_000_000, "sapling"));
    const baseline = computeShieldedEstimate(makeTx(1_700_000_600, "sapling")).amount;
    const fastOne = computeShieldedEstimate(makeTx(1_700_000_660, "sapling")).amount;
    const fastTwo = computeShieldedEstimate(makeTx(1_700_000_690, "sapling")).amount;
    expect(fastOne).toBeGreaterThan(baseline);
    expect(fastTwo).toBeGreaterThan(baseline);
  });

  it("increases confidence as history grows", () => {
    let lastConfidence = 0;
    for (let i = 0; i < 50; i++) {
      const result = computeShieldedEstimate(makeTx(1_700_000_000 + i * 120, "sapling"));
      if (i === 0) {
        lastConfidence = result.confidence;
        continue;
      }
      expect(result.confidence).toBeGreaterThanOrEqual(lastConfidence - 0.05);
      lastConfidence = result.confidence;
    }
    expect(lastConfidence).toBeGreaterThan(0.5);
  });
});

