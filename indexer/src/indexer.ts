import "dotenv/config";
import { ethers } from "ethers";
import { FhenixClient, EncryptionTypes } from "@fhenixprotocol/fhenixjs";
import { LightwalletdClient } from "./clients/lightwalletd.js";

const {
  FHENIX_RPC_URL = "https://api.nitrogen.fhenix.zone",
  ORACLE_ADDRESS,
  INDEXER_PRIVATE_KEY,
  SUBMISSION_SCALE = "10000",
  MAX_BATCH_SIZE = "32",
  POLL_INTERVAL_MS = "15000",
  LIGHTWALLETD_ENDPOINT = "http://localhost:9067",
} = process.env;

if (!ORACLE_ADDRESS || !INDEXER_PRIVATE_KEY) {
  throw new Error("Missing ORACLE_ADDRESS or INDEXER_PRIVATE_KEY in env");
}

const oracleAbi = [
  "function submitData(bytes encryptedAmount) external",
  "function periodDuration() view returns (uint256)",
  "function periodStart() view returns (uint256)",
] as const;

class ZcashEstimator {
  estimateAmount(txTime: number): number {
    // TODO: implement statistical estimator described in ZCASH_ECOSYSTEM_STUDY.md
    return Math.floor(Math.random() * 1_000_000);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(FHENIX_RPC_URL);
  const wallet = new ethers.Wallet(INDEXER_PRIVATE_KEY!, provider);
  const oracle = new ethers.Contract(ORACLE_ADDRESS, oracleAbi, wallet);
  const fhe = new FhenixClient({ provider });

  const lightwalletd = new LightwalletdClient(LIGHTWALLETD_ENDPOINT);
  const estimator = new ZcashEstimator();

  let cursor = Math.floor(Date.now() / 1000);
  const scale = Number(SUBMISSION_SCALE);
  const maxBatch = Number(MAX_BATCH_SIZE);
  const pollMs = Number(POLL_INTERVAL_MS);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const txs = await lightwalletd.fetchRecentTransactions(cursor);
    if (txs.length > 0) {
      const batch = txs.slice(0, maxBatch);
      for (const tx of batch) {
        const estimate = estimator.estimateAmount(tx.blockTime);
        const scaled = Math.min(estimate * scale, 2 ** 32 - 1);

        const encrypted = await fhe.encrypt(scaled, EncryptionTypes.uint32);
        const txResponse = await oracle.submitData(encrypted);
        await txResponse.wait();

        cursor = Math.max(cursor, tx.blockTime);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error("Indexer loop failed", error);
  process.exit(1);
});

