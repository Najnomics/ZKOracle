import "dotenv/config";
import { loadConfig } from "../config.js";
import { ZcashRpcClient, ZcashShieldedTx } from "../clients/zcashRpc.js";
import { log, sendAlert } from "../logger.js";

const DEFAULT_INTERVAL_MS = 60_000;
const STALL_THRESHOLD_MS = 5 * 60_000;

async function main() {
  const config = loadConfig();
  if (!config.ZCASHD_RPC_URL || !config.ZCASHD_RPC_USER || !config.ZCASHD_RPC_PASSWORD) {
    log.warn("Zcash RPC not configured; watcher exiting");
    return;
  }

  const client = new ZcashRpcClient(
    config.ZCASHD_RPC_URL,
    config.ZCASHD_RPC_USER,
    config.ZCASHD_RPC_PASSWORD,
  );

  const pollInterval = Number(process.env.ZCASH_WATCH_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  let lastSeen = Date.now();

  log.info("Starting Zcash watcher", { pollInterval });

  const cycle = async () => {
    try {
      for (const addr of config.WALLETD_Z_ADDRS) {
        if (!addr) continue;
        const txs = await client.listReceivedByAddress(addr, 1);
        const latest = Math.max(
          0,
          ...txs.map((tx: ZcashShieldedTx) =>
            typeof tx.blocktime === "number" ? tx.blocktime * 1000 : 0,
          ),
        );
        if (latest > lastSeen) {
          lastSeen = latest;
          log.info("New shielded activity detected", { address: addr, epoch: latest });
        }
      }

      if (Date.now() - lastSeen > STALL_THRESHOLD_MS) {
        await sendAlert("No new shielded tx observed via zcashd", { since: new Date(lastSeen).toISOString() });
      }
    } catch (error) {
      log.error("Watcher cycle failed", { error });
      await sendAlert("Zcash watcher failure", { error: (error as Error).message });
    }
  };

  await cycle();
  setInterval(() => void cycle(), pollInterval);
}

main().catch((error) => {
  log.error("Zcash watcher crashed", { error });
  process.exit(1);
});
