import Database from "better-sqlite3";

interface CursorRecord {
  cursor: number;
}

interface LeaseRow {
  holder: string | null;
  expires_at: number | null;
  updated_at: number | null;
}

export interface LeaseState {
  holder: string | null;
  expiresAt: number | null;
  updatedAt: number | null;
}

export class SqliteStateStore {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cursor_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_txs (
        txid TEXT PRIMARY KEY,
        seen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordination_lease (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        holder TEXT,
        expires_at INTEGER,
        updated_at INTEGER
      );
    `);

    const cursorRow = this.db.prepare("SELECT cursor FROM cursor_state WHERE id = 1").get();
    if (!cursorRow) {
      this.db.prepare("INSERT INTO cursor_state (id, cursor) VALUES (1, ?)").run(Math.floor(Date.now() / 1000));
    }

    const leaseRow = this.db.prepare("SELECT holder FROM coordination_lease WHERE id = 1").get();
    if (!leaseRow) {
      this.db
        .prepare("INSERT INTO coordination_lease (id, holder, expires_at, updated_at) VALUES (1, NULL, 0, 0)")
        .run();
    }
  }

  close(): void {
    this.db.close();
  }

  getCursor(): number {
    const row = this.db.prepare("SELECT cursor FROM cursor_state WHERE id = 1").get() as CursorRecord;
    return row.cursor;
  }

  setCursor(cursor: number): void {
    this.db.prepare("UPDATE cursor_state SET cursor = ? WHERE id = 1").run(cursor);
  }

  markProcessed(txid: string, seenAt: number): void {
    const timestamp = Math.max(seenAt, Math.floor(Date.now() / 1000));
    this.db.prepare("INSERT OR IGNORE INTO processed_txs (txid, seen_at) VALUES (?, ?)").run(txid, timestamp);
  }

  hasProcessed(txid: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM processed_txs WHERE txid = ?").get(txid);
    return !!row;
  }

  getProcessedCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM processed_txs").get() as { count: number };
    return row.count;
  }

  clearProcessed(): void {
    this.db.prepare("DELETE FROM processed_txs").run();
  }

  purgeProcessedOlderThan(seconds: number, nowSeconds = Math.floor(Date.now() / 1000)): number {
    const threshold = nowSeconds - seconds;
    const result = this.db.prepare("DELETE FROM processed_txs WHERE seen_at < ?").run(threshold);
    return result.changes ?? 0;
  }

  getLeaseState(): LeaseState {
    const row = this.db.prepare("SELECT holder, expires_at, updated_at FROM coordination_lease WHERE id = 1").get() as
      | LeaseRow
      | undefined;
    if (!row) return { holder: null, expiresAt: null, updatedAt: null };
    return {
      holder: row.holder,
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
    };
  }

  claimLease(instanceId: string, ttlSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    const lease = this.getLeaseState();
    if (lease.holder && lease.holder !== instanceId && lease.expiresAt && lease.expiresAt > nowSeconds) {
      return false;
    }

    this.db
      .prepare("UPDATE coordination_lease SET holder = ?, expires_at = ?, updated_at = ? WHERE id = 1")
      .run(instanceId, nowSeconds + ttlSeconds, nowSeconds);
    return true;
  }

  releaseLease(instanceId: string): boolean {
    const lease = this.getLeaseState();
    if (lease.holder !== instanceId) {
      return false;
    }
    this.db.prepare("UPDATE coordination_lease SET holder = NULL, expires_at = 0, updated_at = ? WHERE id = 1").run(
      Math.floor(Date.now() / 1000),
    );
    return true;
  }
}
