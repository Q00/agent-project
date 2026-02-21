import { randomUUID } from 'node:crypto';
import { openDatabase, nowIso, withTransaction } from './db.js';

const LOCK_TTL_MS = 120000;
const HEARTBEAT_MS = 30000;

function parseOrNow(v, fallback = null) {
  return v ? new Date(v).getTime() : fallback;
}
function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}
function nextSeq(db, sessionId) {
  const row = db.prepare('SELECT COALESCE(MAX(event_seq),0) AS seq FROM event_log WHERE session_id = ?').get(sessionId);
  return ((row?.seq ?? 0) + 1);
}

function ensureSession(db, sessionId, namespace) {
  const existing = db.prepare('SELECT session_id FROM session_state WHERE session_id=?').get(sessionId);
  const now = nowIso();
  if (!existing) {
    db.prepare(`INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at)
                VALUES(?, ?, 'idle', 'idle', ?, ?)`).run(sessionId, namespace, now, now);
  }
}

export function claimTask({ db, sessionId, namespace = 'default', taskTypeFilter = null, agent = 'agent' }) {
  const lockKey = `session:${sessionId}:lock`;
  const now = nowIso();
  const lockToken = randomUUID();
  const expiresAt = addMs(now, LOCK_TTL_MS);

  try {
    return withTransaction(db, () => {
      ensureSession(db, sessionId, namespace);

      const lock = db.prepare('SELECT owner_token, expires_at FROM distributed_lock WHERE lock_key=?').get(lockKey);
      if (lock) {
        const expired = new Date(lock.expires_at).getTime() <= Date.now();
        if (!expired) {
          return { ok: false, reason: 'busy' };
        }
        const takeover = db.prepare(`UPDATE distributed_lock SET owner_token=?, owner_agent=?, acquired_at=?, expires_at=?, version=version+1
                                   WHERE lock_key=? AND owner_token=?`).run(lockToken, agent, now, expiresAt, lockKey, lock.owner_token);
        if (takeover.changes === 0) {
          return { ok: false, reason: 'busy' };
        }
      } else {
        db.prepare(`INSERT INTO distributed_lock(lock_key, owner_token, owner_agent, acquired_at, expires_at, version)
                    VALUES(?, ?, ?, ?, ?, 1)`).run(lockKey, lockToken, agent, now, expiresAt);
      }

      const pendingRow = db.prepare(`SELECT task_id, task_type, payload, status FROM task_queue
                                 WHERE session_id=? AND status='pending' ${taskTypeFilter ? 'AND task_type=?' : ''}
                                 ORDER BY priority ASC, created_at ASC LIMIT 1`)
                        .get(sessionId, ...(taskTypeFilter ? [taskTypeFilter] : []));
      let taskRow = pendingRow;
      if (!taskRow) {
        const runningRow = db.prepare(`SELECT t.task_id, t.task_type, t.payload, t.status
                                     FROM task_queue t
                                     JOIN session_state s ON s.session_id = t.session_id
                                     WHERE s.session_id=? AND s.inflight_task_id = t.task_id AND t.status='running'
                                     ORDER BY t.started_at DESC LIMIT 1`)
                              .get(sessionId);
        taskRow = runningRow || null;
      }
      if (!taskRow) {
        db.prepare('DELETE FROM distributed_lock WHERE lock_key=? AND owner_token=?').run(lockKey, lockToken);
        return { ok: false, reason: 'no_task' };
      }

      const idem = `task-claim:${taskRow.task_id}`;
      const seq = nextSeq(db, sessionId);
      try {
        db.prepare(`INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, idempotency_key, payload, status)
                    VALUES(?, ?, 'task_claimed', ?, ?, ?, 'ok')`)
          .run(sessionId, seq, agent, idem, taskRow.payload);
      } catch (e) {
        if (/UNIQUE/.test(String(e.message))) {
          if (taskRow.status === 'running') {
            // stale takeover of in-flight task: reuse inflight task
            const existingSeq = nextSeq(db, sessionId) - 1;
            db.prepare(`UPDATE session_state SET status='running', phase='running', inflight_task_id=?, checkpoint_seq=?, heartbeat_at=?, lock_token=?, lock_expires_at=?, updated_at=?
                        WHERE session_id=?`)
              .run(taskRow.task_id, existingSeq, now, lockToken, expiresAt, now, sessionId);
            return { ok: true, sessionId, taskId: taskRow.task_id, lockToken, ttlMs: LOCK_TTL_MS, takeover: true };
          }
          db.prepare('UPDATE distributed_lock SET version=version+1 WHERE lock_key=? AND owner_token=?').run(lockKey, lockToken);
          return { ok: false, reason: 'dupe_or_owned' };
        }
        throw e;
      }

      db.prepare(`UPDATE task_queue SET status='running', owner_agent=?, started_at=? WHERE task_id=?`).run(agent, now, taskRow.task_id);
      db.prepare(`UPDATE session_state SET status='running', phase='running', inflight_task_id=?, checkpoint_seq=?, heartbeat_at=?, lock_token=?, lock_expires_at=?, updated_at=?
                  WHERE session_id=?`)
        .run(taskRow.task_id, seq, now, lockToken, expiresAt, now, sessionId);

      return { ok: true, sessionId, taskId: taskRow.task_id, lockToken, ttlMs: LOCK_TTL_MS };
    });
  } catch (err) {
    return { ok: false, reason: 'error', error: String(err) };
  }
}

export function heartbeat({ db, sessionId, lockToken, agent = 'agent' }) {
  const lockKey = `session:${sessionId}:lock`;
  const now = nowIso();
  const expiresAt = addMs(now, LOCK_TTL_MS);
  const updated = db.prepare(`UPDATE distributed_lock SET owner_agent=?, acquired_at=?, expires_at=?
                             WHERE lock_key=? AND owner_token=?`).run(agent, now, expiresAt, lockKey, lockToken);
  if (updated.changes === 0) return false;
  db.prepare(`UPDATE session_state SET heartbeat_at=?, updated_at=?, lock_expires_at=? WHERE session_id=? AND lock_token=?`)
    .run(now, now, expiresAt, sessionId, lockToken);
  return true;
}

export function releaseTask({ db, sessionId, taskId, lockToken, result, agent = 'agent' }) {
  const lockKey = `session:${sessionId}:lock`;
  const now = nowIso();
  const lock = db.prepare('SELECT owner_token FROM distributed_lock WHERE lock_key=?').get(lockKey);
  if (!lock || lock.owner_token !== lockToken) return { ok: false, reason: 'lock_mismatch' };

  const status = result.ok ? 'done' : 'failed';
  const eventType = result.ok ? 'task_finished' : 'task_failed';
  const idem = `task-finalize:${taskId}`;

  return withTransaction(db, () => {
    const seq = nextSeq(db, sessionId);
    try {
      db.prepare(`INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, idempotency_key, payload, status, error_code)
                  VALUES(?, ?, ?, ?, ?, ?, ?, ?)`) 
        .run(sessionId, seq, eventType, agent, idem, JSON.stringify({ task_id: taskId, result }), status, result.errorCode || null);
    } catch (e) {
      if (!/UNIQUE/.test(String(e.message))) throw e;
      // Already finalized; still return success
    }

    db.prepare(`UPDATE task_queue SET status=?, finished_at=?, error_code=?, error_msg=? WHERE task_id=?`)
      .run(status, now, result.errorCode || null, result.errorMsg || null, taskId);
    const chkSeq = seq;
    db.prepare(`UPDATE session_state SET status='waiting', phase='idle', inflight_task_id=NULL, checkpoint_seq=?, heartbeat_at=?, updated_at=?, lock_token=NULL, lock_expires_at=NULL
                WHERE session_id=?`).run(chkSeq, now, now, sessionId);
    db.prepare('DELETE FROM distributed_lock WHERE lock_key=? AND owner_token=?').run(lockKey, lockToken);
    return { ok: true };
  });
}

export { LOCK_TTL_MS, HEARTBEAT_MS };
