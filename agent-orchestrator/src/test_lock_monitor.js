// Phase 2-4: lock monitor tests
import { openDatabase } from './db.js';
import { runLockMonitor } from './lock_monitor.js';

const { db } = openDatabase();

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

function hasTable(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function ensureSchemas() {
  if (!hasTable('lock_events')) {
    db.prepare(`CREATE TABLE IF NOT EXISTS lock_events (
      lock_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      lock_key TEXT NOT NULL,
      session_id TEXT,
      event_type TEXT NOT NULL,
      actor_agent TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`).run();
  }

  if (!hasTable('distributed_lock')) {
    db.prepare(`CREATE TABLE IF NOT EXISTS distributed_lock (
      lock_key TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      owner_agent TEXT,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )`).run();
  }

  if (!hasTable('session_state')) {
    db.prepare(`CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL DEFAULT 'default',
      phase TEXT NOT NULL DEFAULT 'idle',
      status TEXT NOT NULL DEFAULT 'idle',
      owner_agent TEXT,
      inflight_task_id TEXT,
      last_turn INTEGER NOT NULL DEFAULT 0,
      last_action TEXT,
      next_action TEXT,
      context_hash TEXT,
      checkpoint_seq INTEGER NOT NULL DEFAULT 0,
      memory_ref TEXT,
      heartbeat_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      lock_token TEXT,
      lock_expires_at TEXT
    )`).run();
  }

  if (!hasTable('alerts')) {
    db.prepare(`CREATE TABLE IF NOT EXISTS alerts (
      alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_key TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error', 'critical')),
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      source TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      resolved_at TEXT
    )`).run();
  }
}

function clearTables() {
  const tables = ['lock_events', 'distributed_lock', 'session_state', 'alerts', 'dead_letters', 'task_queue'];
  for (const t of tables) {
    if (hasTable(t)) db.prepare(`DELETE FROM ${t}`).run();
  }
}

ensureSchemas();

assert(hasTable('distributed_lock'), 'distributed_lock exists');
assert(hasTable('session_state'), 'session_state exists');
assert(hasTable('lock_events'), 'lock_events exists');

clearTables();

const now = new Date();
const stale = new Date(now.getTime() - 120000 - 1000).toISOString();
const oldAcquired = new Date(now.getTime() - 300000).toISOString();

// orphan lock (no session) + very old
db.prepare(`INSERT INTO distributed_lock(lock_key, owner_token, owner_agent, acquired_at, expires_at, version)
            VALUES(?, ?, ?, ?, ?, 1)`).run('session:s-orphan:lock', 't1', 'agent-a', oldAcquired, stale);

// session+lock mismatch scenario
db.prepare(`INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at, lock_token, lock_expires_at)
            VALUES(?,?,?,?,?,?,?,?)`)
  .run('s-active', 'default', 'running', 'running', now.toISOString(), now.toISOString(), 'owner-good', now.toISOString());
db.prepare(`INSERT INTO distributed_lock(lock_key, owner_token, owner_agent, acquired_at, expires_at, version)
            VALUES(?, ?, ?, ?, ?, 1)`).run('session:s-active:lock', 'owner-bad', 'agent-b', oldAcquired, stale);

const mismatch = runLockMonitor({
  db,
  actor: 'watchdog-test',
  windowMinutes: 60,
  autoRecover: true,
  thresholdOverrides: {
    orphanedLocks: 0,
    lockConflictEvents: 0,
  },
});

assert(mismatch.metrics.orphanedLocks >= 1, 'orphaned lock metric increments');
assert(Array.isArray(mismatch.alerts), 'alerts array exists');
assert(mismatch.alerts.some((a) => a.key === 'orphanedLocks'), 'orphanedLocks alert triggered');

const remaining = db.prepare(`SELECT COUNT(*) AS c FROM distributed_lock`).get().c;
assert(remaining === 0, 'recovery removed all stale/conflicting locks in test setup');

const ev = mismatch.metrics.lockConflictEvents;
assert(ev >= 0, 'lock conflict metric available');

console.log('All Phase 2-4 lock monitor tests passed ✅');

db.close();
