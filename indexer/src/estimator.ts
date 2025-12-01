import { ShieldedTxMetadata } from "./clients/lightwalletd.js";

const WINDOW = 50;
const alpha = 0.6;
let weightedAverage = 75_000;
const history: number[] = [];

export function computeShieldedEstimate(tx: ShieldedTxMetadata): number {
  const timingComponent = Math.sin(tx.blockTime / 600) * 15_000 + 50_000;
  if (history.length) {
    const recentAverage = history.reduce((acc, value) => acc + value, 0) / history.length;
    weightedAverage = alpha * timingComponent + (1 - alpha) * recentAverage;
  } else {
    weightedAverage = timingComponent;
  }

  const rounded = Math.max(1, Math.round(weightedAverage));
  history.push(rounded);
  if (history.length > WINDOW) {
    history.shift();
  }

  return rounded;
}

