import { ShieldedTxMetadata } from "./clients/lightwalletd.js";

type Pool = ShieldedTxMetadata["pool"];

const MAX_WINDOW = 500;
const EWMA_ALPHA = 0.35;
const poolWeights: Record<Pool, number> = {
  sapling: 1.0,
  orchard: 1.15,
};

const history: number[] = [];
let ewma = 90_000;

function seasonalityComponent(timestamp: number): number {
  const hourly = Math.sin(timestamp / 3600) * 10_000;
  const daily = Math.sin(timestamp / 86400) * 5_000;
  return hourly + daily + 70_000;
}

export function computeShieldedEstimate(tx: ShieldedTxMetadata): number {
  const seasonal = seasonalityComponent(tx.blockTime);
  ewma = EWMA_ALPHA * seasonal + (1 - EWMA_ALPHA) * ewma;

  const bias = poolWeights[tx.pool] ?? 1;
  const estimate = Math.max(1, Math.round(ewma * bias));

  history.push(estimate);
  if (history.length > MAX_WINDOW) history.shift();

  return estimate;
}

export function resetEstimatorState(): void {
  history.length = 0;
  ewma = 90_000;
}

