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

  it("returns positive values for sapling pool", () => {
    const amount = computeShieldedEstimate(makeTx(1_700_000_000, "sapling"));
    expect(amount).toBeGreaterThan(0);
  });

  it("applies pool bias for orchard", () => {
    const sapling = computeShieldedEstimate(makeTx(1_700_000_000, "sapling"));
    const orchard = computeShieldedEstimate(makeTx(1_700_000_100, "orchard"));
    expect(orchard).toBeGreaterThan(sapling);
  });

  it("responds to time-based seasonality", () => {
    const low = computeShieldedEstimate(makeTx(1_700_000_000, "sapling"));
    const high = computeShieldedEstimate(makeTx(1_700_000_000 + 3600, "sapling"));
    expect(Math.abs(high - low)).toBeGreaterThan(100);
  });
});

