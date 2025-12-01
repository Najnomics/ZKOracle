#!/usr/bin/env node
import "dotenv/config";
import { loadConfig } from "./config.js";
import { SqliteStateStore } from "./persistence/sqliteStore.js";

const usage = `
Usage: pnpm cli <command>

Commands:
  cursor           Print current cursor height/timestamp
  processed        Print number of processed shielded transactions
  reset-cursor     Reset cursor to current time (use with caution)
  lease            Show lease holder and expiry
  force-release    Release the lease for this instance id
`;

async function main() {
  const command = process.argv[2];
  if (!command) {
    console.log(usage);
    process.exit(0);
  }

  const config = loadConfig();
  const store = new SqliteStateStore(config.STATE_DB_PATH);

  try {
    switch (command) {
      case "cursor":
        console.log("Current cursor:", store.getCursor());
        break;
      case "processed":
        console.log("Processed tx count:", store.getProcessedCount());
        break;
      case "reset-cursor":
        store.setCursor(Math.floor(Date.now() / 1000));
        console.log("Cursor reset to now.");
        break;
      case "lease":
        console.log("Lease state:", store.getLeaseState());
        break;
      case "force-release":
        const released = store.releaseLease(config.INDEXER_INSTANCE_ID);
        console.log(
          released
            ? "Lease released for this instance."
            : "Lease not held by this instance; nothing changed.",
        );
        break;
      default:
        console.log(`Unknown command: ${command}`);
        console.log(usage);
    }
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error("CLI command failed:", error);
  process.exit(1);
});

