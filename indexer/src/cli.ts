#!/usr/bin/env node
import "dotenv/config";
import { loadConfig } from "./config.js";
import { SqliteStateStore } from "./persistence/sqliteStore.js";

const usage = `
Usage: pnpm cli <command>

Commands:
  cursor          Print current cursor height/timestamp
  processed       Print number of processed shielded transactions
  reset-cursor    Reset cursor to current time (use with caution)
`;

async function main() {
  const command = process.argv[2];
  if (!command) {
    console.log(usage);
    process.exit(0);
  }

  const config = loadConfig();
  const store = new SqliteStateStore(config.STATE_DB_PATH);

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
    default:
      console.log(`Unknown command: ${command}`);
      console.log(usage);
  }
}

main().catch((error) => {
  console.error("CLI command failed:", error);
  process.exit(1);
});

