import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SqliteStateStore } from "./sqliteStore.js";

let store: SqliteStateStore | undefined;

try {
  const dir = mkdtempSync(join(tmpdir(), "zkoracle-"));
  const dbPath = join(dir, "state.db");
  store = new SqliteStateStore(dbPath);
} catch (error) {
  console.warn("Skipping SqliteStateStore tests (native bindings unavailable):", error);
}

(store ? describe : describe.skip)("SqliteStateStore", () => {
  beforeEach(() => {
    store!.setCursor(Math.floor(Date.now() / 1000));
  });

  it("updates cursor", () => {
    const current = store!.getCursor();
    store!.setCursor(current + 10);
    expect(store!.getCursor()).toBe(current + 10);
  });

  it("tracks processed transactions", () => {
    const before = store!.getProcessedCount();
    store!.markProcessed(`tx-${Date.now()}`);
    expect(store!.getProcessedCount()).toBe(before + 1);
  });
});

