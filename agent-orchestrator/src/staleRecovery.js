import { nowIso } from './db.js';
import { logLockEvent } from './ops.js';
import { executeWithRetrySync, getNextRetryAt, isRetryable } from './retryPolicy.js';
import { HEARTBEAT_MS } from './orchestrator.js';

export function staleRecovery({ db, agent = 'watchdog' }) {
  const now = new Date();
  const heartbeatThreshold = new Date(now.getTime() - HEARTBEAT_MS * 2).toISOString();
  const lockThreshold = now.toISOString();

  const rows = db.prepare(`
    SELECT session_id, heartbeat_at, lock_expires_at, inflight_task_id, lock_token
    FROM session_state
    WHERE status IN ('running', 'waiting')
  `).all();

  let recovered = 0;

  for (const row of rows) {
    const hbTimeout = row.heartbeat_at && row.heartbeat_at < heartbeatThreshold;
    const lockExpired = row.lock_expires_at && row.lock_expires_at < lockThreshold;
    if (!(hbTimeout && lockExpired)) continue;

    try {
      executeWithRetrySync(() => {
        const tx = db.transaction(() => {
          const nextSeq = db.prepare('SELECT COALESCE(MAX(event_seq),0) as seq FROM event_log WHERE session_id=?').get(row.session_id).seq + 1;

          db.prepare(`UPDATE session_state
                      SET status='stale', phase='stale', heartbeat_at=?, updated_at=?, lock_token=NULL, lock_expires_at=NULL
                      WHERE session_id=?`).run(nowIso(), nowIso(), row.session_id);

          db.prepare(`INSERT OR IGNORE INTO event_log(session_id, event_seq, event_type, actor_agent, idempotency_key, payload, status)
                      VALUES(?, ?, 'session_stale', ?, ?, ?, 'ok')`)
            .run(
              row.session_id,
              nextSeq,
              agent,
              `stale:${row.session_id}`,
              JSON.stringify({ heartbeat_at: row.heartbeat_at, lock_expires_at: row.lock_expires_at })
            );

          if (row.inflight_task_id) {
            db.prepare(`
              UPDATE task_queue
              SET status='pending',
                  retry_count = COALESCE(retry_count,0) + 1,
                  last_error = 'stale recovery',
                  next_retry_at = ?
              WHERE task_id=? AND status='running'
            `).run(getNextRetryAt(1, nowIso()), row.inflight_task_id);

            db.prepare(`UPDATE session_state SET inflight_task_id=NULL WHERE session_id=?`).run(row.session_id);
          }

          db.prepare(`DELETE FROM distributed_lock WHERE lock_key=?`).run(`session:${row.session_id}:lock`);
        });
        tx();
        recovered++;
        return true;
      }, {
        taskId: `stale:${row.session_id}`,
        shouldRetry: (err) => isRetryable(err),
        maxRetries: 3
      });
    } catch (err) {
      // Log but continue with other sessions
      logLockEvent({
        db,
        lockKey: `session:${row.session_id}:lock`,
        sessionId: row.session_id,
        eventType: 'stale_recovery_failed',
        actor: 'watchdog',
        payload: { error: err.message }
      });
      console.error(`staleRecovery failed for session ${row.session_id}:`, err.message);
    }
  }

  return { recovered };
}
