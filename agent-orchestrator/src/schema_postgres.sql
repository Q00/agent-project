CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS session_state (
  session_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  inflight_task_id TEXT,
  checkpoint_seq BIGINT,
  lock_token TEXT,
  lock_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_session_id UNIQUE(session_id)
);

CREATE TABLE IF NOT EXISTS task_queue (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'generic',
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  owner_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_msg TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  dedupe_key TEXT,
  FOREIGN KEY (session_id) REFERENCES session_state(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS distributed_lock (
  lock_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  owner_agent TEXT,
  acquired_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_log (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT NOT NULL,
  event_seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor_agent TEXT,
  idempotency_key TEXT,
  payload TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_session_event_seq UNIQUE (session_id, event_seq),
  CONSTRAINT uq_session_event_idem UNIQUE (session_id, idempotency_key),
  FOREIGN KEY (session_id) REFERENCES session_state(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_queue_status_session
  ON task_queue (session_id, status, task_type, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_task_queue_retry
  ON task_queue (next_retry_at, status);
CREATE INDEX IF NOT EXISTS idx_session_state_status
  ON session_state (status, heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_event_lookup
  ON event_log (session_id, created_at, event_type);
CREATE INDEX IF NOT EXISTS idx_lock_expiry
  ON distributed_lock (expires_at);
