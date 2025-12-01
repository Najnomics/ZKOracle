import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
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
    store!.clearProcessed();
  });

  afterAll(() => {
    store?.close();
  });

  it("updates cursor", () => {
    const current = store!.getCursor();
    store!.setCursor(current + 10);
    expect(store!.getCursor()).toBe(current + 10);
  });

  it("tracks processed transactions and retention", () => {
    const now = Math.floor(Date.now() / 1000);
    store!.markProcessed("tx-old", now - 1000);
    store!.markProcessed("tx-new", now);
    expect(store!.getProcessedCount()).toBe(2);
    const purged = store!.purgeProcessedOlderThan(500, now);
    expect(purged).toBe(1);
    expect(store!.getProcessedCount()).toBe(1);
  });

  it("enforces lease ownership", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(store!.claimLease("inst-a", 60, now)).toBe(true);
    expect(store!.claimLease("inst-b", 60, now + 10)).toBe(false);
    expect(store!.claimLease("inst-b", 60, now + 70)).toBe(true); // lease expired
    expect(store!.releaseLease("inst-a")).toBe(false);
    expect(store!.releaseLease("inst-b")).toBe(true);
  });
});

