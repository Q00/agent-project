// Phase 2-4: operational stability helpers

function safePayload(obj = {}) {
  try {
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  } catch (_e) {
    return '{}';
  }
}

export function logLockEvent({ db, lockKey, sessionId = null, eventType, actor = 'agent', payload = {} }) {
  try {
    db.prepare(`
      INSERT INTO lock_events(lock_key, session_id, event_type, actor_agent, payload)
      VALUES(?, ?, ?, ?, ?)
    `).run(
      lockKey || '',
      sessionId,
      eventType,
      actor,
      safePayload(payload)
    );
  } catch (_e) {
    // Optional table for migration-safe startup; metrics reporter should not block core orchestration.
  }
}

export function addDeadLetter({ db, taskId, sessionId, reason, payload = {}, errorCode = null }) {
  try {
    const inserted = db.prepare(`
      INSERT INTO dead_letters(task_id, session_id, reason, payload, error_code)
      VALUES(?, ?, ?, ?, ?)
    `).run(taskId, sessionId, reason, safePayload(payload), errorCode);
    return inserted.changes > 0;
  } catch (e) {
    if (/UNIQUE/.test(String(e.message))) {
      return false;
    }
    // If table absent due migration timing, fail-open to avoid blocking task completion.
    return false;
  }
}

export function closeDeadLetter({ db, taskId }) {
  const result = db.prepare(`
    UPDATE dead_letters
    SET status='resolved', resolved_at=(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE task_id=? AND status='open'
  `).run(taskId);
  return result.changes > 0;
}

export function getOpenDeadLetters({ db, limit = 100 }) {
  return db.prepare(`SELECT * FROM dead_letters WHERE status='open' ORDER BY created_at DESC LIMIT ?`).all(limit);
}
