import "dotenv/config";
import { ethers } from "ethers";
import { FhenixClient, EncryptionTypes } from "fhenixjs";
import { LightwalletdClient } from "./clients/lightwalletd.js";
import { ZcashRpcClient } from "./clients/zcashRpc.js";
import { loadConfig } from "./config.js";
import { log, sendAlert } from "./logger.js";
import { SqliteStateStore } from "./persistence/sqliteStore.js";
import { computeShieldedEstimate } from "./estimator.js";
import { startMetricsServer, stats } from "./metrics.js";
import { fetchWithRetries } from "./utils/retry.js";

const ORACLE_ABI = [
  "function submitData(bytes encryptedAmount) external",
  "function periodDuration() view returns (uint256)",
  "function periodStart() view returns (uint256)",
] as const;

async function runIndexer() {
  const config = loadConfig();
  startMetricsServer(config.METRICS_PORT);

  const provider = new ethers.JsonRpcProvider(config.FHENIX_RPC_URL);
  const wallet = new ethers.Wallet(config.INDEXER_PRIVATE_KEY, provider);
  const oracle = new ethers.Contract(config.ORACLE_ADDRESS, ORACLE_ABI, wallet);
  type FhenixProvider = ConstructorParameters<typeof FhenixClient>[0]["provider"];
  const fheProvider = provider as unknown as FhenixProvider;
  const fhe = new FhenixClient({ provider: fheProvider });

  const lightwalletd = new LightwalletdClient(
    config.LIGHTWALLETD_ENDPOINT,
    config.LIGHTWALLETD_USE_TLS,
  );
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

  while (true) {
    try {
      const lightwalletdTxs = await fetchWithRetries(() =>
        lightwalletd.fetchRecentTransactions(cursor, config.WALLETD_Z_ADDRS),
      );

      const txs = lightwalletdTxs.filter((tx) => !store.hasProcessed(tx.txid));
      if (zcashd && txs.length === 0) {
        const supplemental = await fetchWithRetries(() =>
          zcashd.listReceivedByAddress("shielded-address-placeholder"),
        );
        supplemental.forEach((tx) => {
          if (!store.hasProcessed(tx.txid)) {
            txs.push({
              txid: tx.txid,
              blockTime: tx.blocktime ?? Math.floor(Date.now() / 1000),
              pool: "sapling",
            });
          }
        });
      }

      if (txs.length > 0) {
        const batch = txs.slice(0, config.MAX_BATCH_SIZE);
        log.info("Submitting batch", { batchSize: batch.length });

        for (const tx of batch) {
          const { amount: estimate, confidence } = computeShieldedEstimate(tx);
          const scaled = Math.min(estimate * config.SUBMISSION_SCALE, 2 ** 32 - 1);

          const encrypted = await fhe.encrypt(scaled, EncryptionTypes.uint32);
          const response = await fetchWithRetries(() => oracle.submitData(encrypted));
          await response.wait();

          store.markProcessed(tx.txid);
          cursor = Math.max(cursor, tx.blockTime);
          stats.incrementSubmitted();
          log.debug("Submitted encrypted estimate", {
            txid: tx.txid,
            estimate,
            confidence,
          });
        }

        store.setCursor(cursor);
        log.info("Batch submitted", { cursor });
      } else {
        log.info("No new shielded txs found");
      }
    } catch (error) {
      log.error("Indexer loop iteration failed", { error });
      await sendAlert("Indexer loop error", { error: (error as Error).message });
    }

    stats.incrementIterations();
    await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
  }
}

runIndexer().catch((error) => {
  log.error("Indexer crashed", { error });
  process.exit(1);
});

