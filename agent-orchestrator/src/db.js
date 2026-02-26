import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const defaultDbPath =
  process.env.ORCH_DB_PATH ||
  path.join(process.env.HOME, ".openclaw", "data", "orchestrator.db");

export function openDatabase(customPath = null) {
  const dbPath = customPath || process.env.ORCH_DB_PATH || defaultDbPath;

  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 500");
  return { db, dbPath };
}

export function nowIso() {
  return new Date().toISOString();
}

export function withTransaction(db, fn) {
  const tx = db.transaction(fn);
  return tx();
}
