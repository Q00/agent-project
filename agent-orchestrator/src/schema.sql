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
  status TEXT NOT NULL DEFAULT 'pending',
  owner_agent TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  finished_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
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
