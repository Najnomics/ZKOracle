import Database from "better-sqlite3";

export interface CursorRecord {
  cursor: number;
}

export interface ProcessedTxRecord {
  txid: string;
  seenAt: number;
}

export class SqliteStateStore {
  private readonly db: Database.Database;

  constructor(private readonly filePath: string) {
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
    `);

    const row = this.db.prepare("SELECT cursor FROM cursor_state WHERE id = 1").get();
    if (!row) {
      this.db.prepare("INSERT INTO cursor_state (id, cursor) VALUES (1, ?)").run(Math.floor(Date.now() / 1000));
    }
  }

  getCursor(): number {
    const row = this.db.prepare("SELECT cursor FROM cursor_state WHERE id = 1").get() as CursorRecord;
    return row.cursor;
  }

  setCursor(cursor: number): void {
    this.db.prepare("UPDATE cursor_state SET cursor = ? WHERE id = 1").run(cursor);
  }

  markProcessed(txid: string): void {
    this.db.prepare("INSERT OR IGNORE INTO processed_txs (txid, seen_at) VALUES (?, ?)").run(txid, Date.now());
  }

  hasProcessed(txid: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM processed_txs WHERE txid = ?").get(txid);
    return !!row;
  }
}

