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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let leaseExpiry = 0;
  let lastLeaseHolder: string | null = null;
  let closed = false;

  const releaseLeaseAndClose = (signal?: string) => {
    if (closed) return;
    closed = true;
    const released = store.releaseLease(config.INDEXER_INSTANCE_ID);
    stats.setLeaseActive(false);
    store.close();
    if (signal) {
      log.info(`Shutting down (${signal})`, { released });
      process.exit(0);
    }
  };

  const ensureLease = async () => {
    while (true) {
      const now = Math.floor(Date.now() / 1000);
      if (now <= leaseExpiry - config.LEASE_RENEW_GRACE_SECONDS) {
        return true;
      }

      const claimed = store.claimLease(config.INDEXER_INSTANCE_ID, config.LEASE_TTL_SECONDS, now);
      if (claimed) {
        leaseExpiry = now + config.LEASE_TTL_SECONDS;
        stats.setLeaseActive(true);
        if (lastLeaseHolder !== config.INDEXER_INSTANCE_ID) {
          log.info("Acquired coordination lease", { instance: config.INDEXER_INSTANCE_ID, expiresAt: leaseExpiry });
          lastLeaseHolder = config.INDEXER_INSTANCE_ID;
        }
        return true;
      }

      const lease = store.getLeaseState();
      stats.setLeaseActive(false);
      const holder = lease.holder ?? "unknown";
      if (holder !== lastLeaseHolder) {
        log.warn("Lease currently held by another instance", lease);
        await sendAlert("Indexer lease unavailable", { lease });
        lastLeaseHolder = holder;
      }
      await sleep(config.LEASE_RETRY_MS);
    }
  };

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.once(signal, () => releaseLeaseAndClose(signal));
  });

  log.info("Indexer booted", {
    oracle: config.ORACLE_ADDRESS,
    pollInterval: config.POLL_INTERVAL_MS,
    scale: config.SUBMISSION_SCALE,
  });

  try {
    while (true) {
      try {
        await ensureLease();

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

          store.markProcessed(tx.txid, tx.blockTime);
          cursor = Math.max(cursor, tx.blockTime);
          stats.incrementSubmitted();
          log.debug("Submitted encrypted estimate", {
            txid: tx.txid,
            estimate,
            confidence,
          });
        }

        store.setCursor(cursor);
        const purged = store.purgeProcessedOlderThan(config.PROCESSED_RETENTION_SECONDS);
        if (purged > 0) {
          log.info("Trimmed processed transaction log", { purged });
        }
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
  } finally {
    releaseLeaseAndClose();
  }
}

runIndexer().catch((error) => {
  log.error("Indexer crashed", { error });
  process.exit(1);
});

