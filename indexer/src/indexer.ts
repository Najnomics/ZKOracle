import "dotenv/config";
import { ethers } from "ethers";
import { FhenixClient, EncryptionTypes } from "fhenixjs";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express-serve-static-core";
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
  "function finalizePeriod() external",
  "function periodDuration() view returns (uint256)",
  "function periodStart() view returns (uint256)",
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runIndexer() {
  const config = loadConfig();

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
  let lastSubmissionAt = Date.now();
  let backlogAlerted = false;

  type HealthState = {
    instanceId: string;
    cursor: number;
    leaseHolder: string | null;
    leaseExpiresAt: number;
    leaseActive: boolean;
    lastLoopAt: number;
    lastFinalizeAt?: number;
    lastError?: string;
    submitting?: string;
    lastSubmissionAt: number;
    backlogMs: number;
    backlogAlertActive: boolean;
  };

  const health: HealthState = {
    instanceId: config.INDEXER_INSTANCE_ID,
    cursor,
    leaseHolder: null,
    leaseExpiresAt: 0,
    leaseActive: false,
    lastLoopAt: Date.now(),
    lastSubmissionAt: Date.now(),
    backlogMs: 0,
    backlogAlertActive: false,
  };

  const handleCutover = async (req: ExpressRequest, res: ExpressResponse) => {
    if (!config.CUTOVER_SHARED_SECRET) {
      res.status(403).json({ status: "disabled" });
      return;
    }
    const tokenHeader = req.header("x-cutover-token") ?? req.header("authorization") ?? "";
    const token = typeof req.body?.token === "string" ? req.body.token : tokenHeader;
    if (!token || token.trim() !== config.CUTOVER_SHARED_SECRET) {
      res.status(403).json({ status: "forbidden" });
      return;
    }
    const requestedId =
      typeof req.body?.instanceId === "string" && req.body.instanceId.trim().length > 0
        ? req.body.instanceId.trim()
        : config.INDEXER_INSTANCE_ID;

    const leaseBefore = store.getLeaseState();
    const released = leaseBefore.holder ? store.releaseLease(leaseBefore.holder) : true;
    const now = Math.floor(Date.now() / 1000);
    const claimed = store.claimLease(requestedId, config.LEASE_TTL_SECONDS, now);

    if (claimed) {
      health.leaseHolder = requestedId;
      health.leaseExpiresAt = now + config.LEASE_TTL_SECONDS;
      health.leaseActive = true;
      await sendAlert("Indexer lease cutover executed", {
        previousHolder: leaseBefore.holder,
        newHolder: requestedId,
        requestedBy: req.body?.requestedBy ?? "api",
      });
      log.warn("Lease cutover requested; new holder assigned", {
        previousHolder: leaseBefore.holder,
        newHolder: requestedId,
      });
      res.json({
        status: "ok",
        released,
        claimed,
        holder: health.leaseHolder,
        expiresAt: health.leaseExpiresAt,
      });
    } else {
      await sendAlert("Indexer lease cutover blocked (lease still active)", {
        previousHolder: leaseBefore.holder,
        expiresAt: leaseBefore.expiresAt,
        requestedHolder: requestedId,
      });
      res.status(409).json({
        status: "blocked",
        released,
        claimed,
        holder: leaseBefore.holder,
        expiresAt: leaseBefore.expiresAt,
      });
    }
  };

  startMetricsServer(
    config.METRICS_PORT,
    () => ({
      ...health,
      timestamp: Date.now(),
    }),
    { cutover: handleCutover },
  );

  const releaseLeaseAndClose = (signal?: string) => {
    if (closed) return;
    closed = true;
    const released = store.releaseLease(config.INDEXER_INSTANCE_ID);
    stats.setLeaseActive(false);
    health.leaseActive = false;
    health.leaseHolder = null;
    health.leaseExpiresAt = 0;
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
        health.leaseActive = true;
        health.leaseHolder = config.INDEXER_INSTANCE_ID;
        health.leaseExpiresAt = leaseExpiry;
        health.lastError = undefined;
        if (lastLeaseHolder !== config.INDEXER_INSTANCE_ID) {
          log.info("Acquired coordination lease", { instance: config.INDEXER_INSTANCE_ID, expiresAt: leaseExpiry });
          lastLeaseHolder = config.INDEXER_INSTANCE_ID;
        }
        return true;
      }

      const lease = store.getLeaseState();
      stats.setLeaseActive(false);
      health.leaseActive = false;
      health.leaseHolder = lease.holder;
      health.leaseExpiresAt = lease.expiresAt ?? 0;
      const holder = lease.holder ?? "unknown";
      if (holder !== lastLeaseHolder) {
        log.warn("Lease currently held by another instance", lease);
        await sendAlert("Indexer lease unavailable", { lease });
        lastLeaseHolder = holder;
      }
      await sleep(config.LEASE_RETRY_MS);
    }
  };
  const maybeFinalizePeriod = async () => {
    const [start, duration] = await Promise.all([oracle.periodStart(), oracle.periodDuration()]);
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) return;
    const deadline = Number(start) + Number(duration);
    if (latestBlock.timestamp < deadline) {
      return;
    }

    try {
      const tx = await fetchWithRetries(() => oracle.finalizePeriod());
      await tx.wait();
      log.info("Finalized oracle period", { deadline, timestamp: latestBlock.timestamp });
      health.lastFinalizeAt = Date.now();
    } catch (error) {
      const message = (error as Error).message || "";
      if (message.includes("OracleNoSamples")) {
        log.info("Skipped finalize (no samples)", { deadline });
      } else if (message.includes("OraclePeriodActive")) {
        log.debug("Finalize not ready yet despite deadline check");
      } else {
        log.error("Failed to finalize oracle period", { error: message });
        await sendAlert("Finalize period failed", { error: message });
        health.lastError = message;
      }
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
          health.submitting = tx.txid;
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
        lastSubmissionAt = Date.now();
        health.lastSubmissionAt = lastSubmissionAt;
        backlogAlerted = false;
        health.backlogAlertActive = false;
      } else {
        log.info("No new shielded txs found");
      }
      health.cursor = cursor;
      health.lastError = undefined;
      health.submitting = undefined;
      } catch (error) {
        log.error("Indexer loop iteration failed", { error });
        health.lastError = (error as Error).message;
        await sendAlert("Indexer loop error", { error: (error as Error).message });
      }

      health.lastLoopAt = Date.now();
      health.lastSubmissionAt = lastSubmissionAt;
      const idleMs = Date.now() - lastSubmissionAt;
      health.backlogMs = idleMs;
      if (idleMs >= config.BACKLOG_ALERT_MS) {
        if (!backlogAlerted) {
          backlogAlerted = true;
          health.backlogAlertActive = true;
          const minutes = Math.round(idleMs / 60000);
          log.warn("Indexer idle longer than threshold", { minutes });
          await sendAlert("Indexer idle threshold exceeded", { idleMs, threshold: config.BACKLOG_ALERT_MS });
        }
      } else if (backlogAlerted) {
        backlogAlerted = false;
        health.backlogAlertActive = false;
      }
      await maybeFinalizePeriod();

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

