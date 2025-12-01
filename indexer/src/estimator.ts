import { ShieldedTxMetadata } from "./clients/lightwalletd.js";

const MAX_HISTORY = 256;

export class HeuristicEstimator {
  private history: number[] = [];

  estimate(tx: ShieldedTxMetadata): number {
    const base = 50_000 + Math.sin(tx.blockTime / 900) * 20_000;
    const smoothing = this.history.length
      ? this.history.reduce((sum, value) => sum + value, 0) / this.history.length
      : base;

    const estimate = Math.max(1, Math.round((base + smoothing) / 2));
    this.history.push(estimate);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    return estimate;
  }
}

