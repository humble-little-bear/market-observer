import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { DDL } from "./schema.js";

let _db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  for (const stmt of DDL) {
    db.exec(stmt);
  }
  // Confirm WAL is in effect (it is set via DDL but assert it for clarity).
  const mode = db.pragma("journal_mode", { simple: true }) as string;
  if (String(mode).toLowerCase() !== "wal") {
    db.pragma("journal_mode = WAL");
  }
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
