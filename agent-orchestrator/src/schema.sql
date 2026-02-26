CREATE TABLE IF NOT EXISTS session_state (
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
);

CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session_state(session_id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  owner_agent TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  next_retry_at TEXT,
  error_code TEXT,
  error_msg TEXT
);

CREATE TABLE IF NOT EXISTS distributed_lock (
  lock_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  owner_agent TEXT,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS event_log (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES session_state(session_id) ON DELETE CASCADE,
  event_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_agent TEXT NOT NULL,
  idempotency_key TEXT,
  turn_id INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ok',
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(session_id, event_seq),
  UNIQUE(session_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_session_state_status_updated ON session_state(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_state_heartbeat ON session_state(heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_task_status ON task_queue(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_task_session ON task_queue(session_id);
CREATE INDEX IF NOT EXISTS idx_task_retry ON task_queue(next_retry_at, status, retry_count);
CREATE INDEX IF NOT EXISTS idx_event_log_session_seq ON event_log(session_id, event_seq ASC);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lock_expiry ON distributed_lock(expires_at);

-- Phase 2-4: Operational stability helpers
CREATE TABLE IF NOT EXISTS alerts (
  alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error', 'critical')),
  value REAL NOT NULL,
  threshold REAL NOT NULL,
  source TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS dead_letters (
  dead_letter_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TEXT,
  FOREIGN KEY(session_id) REFERENCES session_state(session_id) ON DELETE CASCADE,
  UNIQUE(task_id)
);

CREATE TABLE IF NOT EXISTS lock_events (
  lock_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  actor_agent TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY(session_id) REFERENCES session_state(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letters_status ON dead_letters(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lock_events_created ON lock_events(created_at DESC, session_id);
