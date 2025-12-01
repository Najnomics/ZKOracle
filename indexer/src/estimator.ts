import { ShieldedTxMetadata } from "./clients/lightwalletd.js";

const MAX_SAMPLES = 200;
const smoothingFactor = 0.4;
const poolBias: Record<ShieldedTxMetadata["pool"], number> = {
  sapling: 1.0,
  orchard: 1.2,
};

const samples: number[] = [];

function weightedAverage(): number {
  if (!samples.length) return 0;
  const totalWeight = samples.length * (samples.length + 1) - samples.length * (samples.length - 1) / 2;
  return (
    samples.reduce((acc, value, index) => acc + value * (index + 1), 0) /
    totalWeight
  );
}

export function computeShieldedEstimate(tx: ShieldedTxMetadata): number {
  const timing = Math.max(1, Math.sin(tx.blockTime / 900) * 25_000 + 80_000);
  const bias = poolBias[tx.pool] ?? 1;

  const baseline = weightedAverage() || 90_000;
  const estimate = smoothingFactor * baseline + (1 - smoothingFactor) * timing * bias;

  const rounded = Math.max(1, Math.round(estimate));
  samples.push(rounded);
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
  }

  return rounded;
}

