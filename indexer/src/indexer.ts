import "dotenv/config";
import { ethers } from "ethers";
import { FhenixClient, EncryptionTypes } from "fhenixjs";
import { LightwalletdClient } from "./clients/lightwalletd.js";
import { ZcashRpcClient } from "./clients/zcashRpc.js";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { SqliteStateStore } from "./persistence/sqliteStore.js";
import { computeShieldedEstimate } from "./estimator.js";
import { startMetricsServer, stats } from "./metrics.js";

const ORACLE_ABI = [
  "function submitData(bytes encryptedAmount) external",
  "function periodDuration() view returns (uint256)",
  "function periodStart() view returns (uint256)",
] as const;

class ZcashEstimator {
  estimateAmount(txTime: number): number {
    // TODO: implement statistical estimator described in ZCASH_ECOSYSTEM_STUDY.md
    const base = Math.sin(txTime / 600) * 50_000 + 75_000;
    return Math.max(1, Math.floor(base + Math.random() * 5_000));
  }
}

async function runIndexer() {
  const config = loadConfig();
  startMetricsServer(config.METRICS_PORT);

  const provider = new ethers.JsonRpcProvider(config.FHENIX_RPC_URL);
  const wallet = new ethers.Wallet(config.INDEXER_PRIVATE_KEY, provider);
  const oracle = new ethers.Contract(config.ORACLE_ADDRESS, ORACLE_ABI, wallet);
  const fhe = new FhenixClient({ provider: provider as any });

  const lightwalletd = new LightwalletdClient(config.LIGHTWALLETD_ENDPOINT);
  const zcashd =
    config.ZCASHD_RPC_URL && config.ZCASHD_RPC_USER && config.ZCASHD_RPC_PASSWORD
      ? new ZcashRpcClient(
          config.ZCASHD_RPC_URL,
          config.ZCASHD_RPC_USER,
          config.ZCASHD_RPC_PASSWORD,
        )
      : undefined;
  const store = new SqliteStateStore(config.STATE_DB_PATH);
  let cursor = store.getCursor();

  log.info("Indexer booted", {
    oracle: config.ORACLE_ADDRESS,
    pollInterval: config.POLL_INTERVAL_MS,
    scale: config.SUBMISSION_SCALE,
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const [lightwalletdTxs] = await Promise.all([
        lightwalletd.fetchRecentTransactions(cursor),
      ]);

      const txs = lightwalletdTxs.filter((tx) => !store.hasProcessed(tx.txid));
      if (zcashd && txs.length === 0) {
        // Optionally fall back to zcashd RPC if lightwalletd yields nothing.
        const supplemental = await zcashd.listReceivedByAddress("shielded-address-placeholder");
        supplemental.forEach((tx) => {
          if (!store.hasProcessed(tx.txid)) {
            txs.push({ txid: tx.txid, blockTime: tx.timestamp, pool: "sapling" });
          }
        });
      }

      if (txs.length > 0) {
        const batch = txs.slice(0, config.MAX_BATCH_SIZE);
        log.info("Submitting batch", { batchSize: batch.length });

        for (const tx of batch) {
          const estimate = computeShieldedEstimate(tx);
          const scaled = Math.min(estimate * config.SUBMISSION_SCALE, 2 ** 32 - 1);

          const encrypted = await fhe.encrypt(scaled, EncryptionTypes.uint32);
          const response = await oracle.submitData(encrypted);
          await response.wait();

          store.markProcessed(tx.txid);
          cursor = Math.max(cursor, tx.blockTime);
          stats.incrementSubmitted();
        }

        store.setCursor(cursor);
        log.info("Batch submitted", { cursor });
      } else {
        log.info("No new shielded txs found");
      }
    } catch (error) {
      log.error("Indexer loop iteration failed", { error });
    }

    stats.incrementIterations();
    await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
  }
}

runIndexer().catch((error) => {
  log.error("Indexer crashed", { error });
  process.exit(1);
});

