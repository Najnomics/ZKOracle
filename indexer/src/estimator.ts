import { ShieldedTxMetadata } from "./clients/lightwalletd.js";

type Pool = ShieldedTxMetadata["pool"];

interface Sample {
  timestamp: number;
  amount: number;
}

export interface EstimateResult {
  amount: number;
  confidence: number; // 0–1
}

const BASELINE_ZEC = 75_000;
const MAX_HISTORY = 720; // roughly last 12h if avg tx every minute
const EWMA_ALPHA = 0.3;
const INTERVAL_MEMORY = 50;

const poolWeights: Record<Pool, number> = {
  sapling: 1.0,
  orchard: 1.18, // orchard txs trend larger per study
};

const history: Sample[] = [];
const interArrival: number[] = [];
let ewma = BASELINE_ZEC;
let lastTimestamp = 0;

function pushHistory(sample: Sample) {
  history.push(sample);
  if (history.length > MAX_HISTORY) history.shift();
  ewma = EWMA_ALPHA * sample.amount + (1 - EWMA_ALPHA) * ewma;
}

function pushInterval(delta: number) {
  interArrival.push(delta);
  if (interArrival.length > INTERVAL_MEMORY) interArrival.shift();
}

function stats() {
  if (history.length === 0) {
    return { mean: BASELINE_ZEC, std: BASELINE_ZEC * 0.1 };
  }
  const values = history.map((s) => s.amount);
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length || 1;
  return { mean, std: Math.sqrt(variance) };
}

function median(values: number[]): number {
  if (values.length === 0) return BASELINE_ZEC;
  const copy = [...values].sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  return copy.length % 2 === 0 ? (copy[mid - 1] + copy[mid]) / 2 : copy[mid];
}

function deriveBaseline(): number {
  if (history.length < 12) return ewma;
  const values = history.map((s) => s.amount);
  const med = median(values);
  const trimmed = values
    .sort((a, b) => a - b)
    .slice(Math.floor(values.length * 0.1), Math.ceil(values.length * 0.9));
  const trimmedMean =
    trimmed.reduce((acc, v) => acc + v, 0) / Math.max(1, trimmed.length);
  return 0.4 * ewma + 0.4 * med + 0.2 * trimmedMean;
}

function seasonalFactor(timestamp: number): number {
  const dayCycle = Math.sin((2 * Math.PI * (timestamp % 86_400)) / 86_400);
  const weekCycle = Math.cos((2 * Math.PI * (timestamp % 604_800)) / 604_800);
  return 1 + dayCycle * 0.08 + weekCycle * 0.05;
}

function networkFactor(timestamp: number): number {
  if (lastTimestamp === 0) return 1;
  const delta = Math.max(1, timestamp - lastTimestamp);
  pushInterval(delta);
  if (interArrival.length < 2) {
    return 1;
  }
  const avgInterval = interArrival.reduce((a, b) => a + b, 0) / interArrival.length;
  const ratio = Math.max(0.25, Math.min(2, delta / Math.max(1, avgInterval)));
  // ratio < 1 → faster-than-average arrival → boost estimate
  return 1 + (1 - ratio) * 0.35;
}

function confidenceFromStats(): number {
  const { mean, std } = stats();
  const sampleFactor = Math.min(1, history.length / 200);
  const volatility = Math.min(1, std / Math.max(mean, 1));
  const stability = 1 - volatility * 0.6;
  const base = 0.5 + sampleFactor * 0.4;
  return Math.min(0.97, Math.max(0.35, base * stability));
}

export function computeShieldedEstimate(tx: ShieldedTxMetadata): EstimateResult {
  const seasonal = seasonalFactor(tx.blockTime);
  const poolBias = poolWeights[tx.pool] ?? 1;
  const netFactor = networkFactor(tx.blockTime);

  const baseline = deriveBaseline();
  const raw = baseline * seasonal * poolBias * netFactor;
  const amount = Math.max(1, Math.round(raw));

  pushHistory({ timestamp: tx.blockTime, amount });
  lastTimestamp = tx.blockTime;

  return {
    amount,
    confidence: confidenceFromStats(),
  };
}

export function resetEstimatorState(): void {
  history.length = 0;
  interArrival.length = 0;
  ewma = BASELINE_ZEC;
  lastTimestamp = 0;
}

