// Phase 2-4: dead-letter handling helpers

import { nowIso } from './db.js';

export function ensureDeadLetterTables(db) {
  const hasDeadLetters = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dead_letters'").get();
  return Boolean(hasDeadLetters);
}

export function addDeadLetter({
  db,
  taskId,
  sessionId,
  reason,
  payload = {},
  errorCode = null,
}) {
  if (!ensureDeadLetterTables(db)) return false;
  const safePayload = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    const result = db.prepare(`
      INSERT INTO dead_letters(task_id, session_id, reason, payload, error_code)
      VALUES(?, ?, ?, ?, ?)
    `).run(taskId, sessionId, reason, safePayload, errorCode);
    return result.changes > 0;
  } catch (e) {
    // unique conflict means already dead-lettered
    if (/UNIQUE/.test(String(e.message))) return false;
    throw e;
  }
}

export function closeDeadLetter({ db, taskId }) {
  if (!ensureDeadLetterTables(db)) return false;
  const result = db.prepare(`
    UPDATE dead_letters
    SET status='resolved', resolved_at=?
    WHERE task_id = ? AND status='open'
  `).run(nowIso(), taskId);
  return result.changes > 0;
}

export function getOpenDeadLetters({ db, limit = 100 }) {
  if (!ensureDeadLetterTables(db)) return [];
  return db.prepare(`
    SELECT *
    FROM dead_letters
    WHERE status='open'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function recoverDeadLetter({ db, taskId, resetRetryCount = false }) {
  if (!ensureDeadLetterTables(db)) return { recovered: false, reason: 'missing_table' };

  const dl = db.prepare(`SELECT * FROM dead_letters WHERE task_id=? AND status='open'`).get(taskId);
  if (!dl) return { recovered: false, reason: 'not_found' };

  const task = db.prepare(`SELECT task_id, session_id, status, retry_count FROM task_queue WHERE task_id=?`).get(taskId);
  if (!task) {
    return { recovered: false, reason: 'task_missing' };
  }

  const run = db.transaction(() => {
    db.prepare(`UPDATE dead_letters SET status='resolved', resolved_at=? WHERE dead_letter_id=?`)
      .run(nowIso(), dl.dead_letter_id);

    let payload = {};
    if (typeof dl.payload === 'string') {
      try {
        payload = JSON.parse(dl.payload || '{}');
      } catch (_e) {
        payload = {};
      }
    } else {
      payload = dl.payload || {};
    }

    let nextRetryAt = nowIso();
    let retryCount = task.retry_count || 0;
    if (resetRetryCount) {
      retryCount = 0;
    }
    db.prepare(`
      UPDATE task_queue
      SET status='pending',
          last_error = ?,
          next_retry_at = ?,
          retry_count = ?,
          error_code = NULL,
          error_msg = NULL
      WHERE task_id=?
    `).run(`recovered: ${payload.reason || 'manual_recover'}`, nextRetryAt, retryCount, taskId);

    return { recovered: true, taskId, sessionId: task.session_id, retryCount };
  });

  return run();
}

export function getDeadLetterByTask({ db, taskId }) {
  if (!ensureDeadLetterTables(db)) return null;
  return db.prepare(`SELECT * FROM dead_letters WHERE task_id=?`).get(taskId);
}

export function seedIfMissing(db) {
  try {
    db.prepare(`INSERT INTO dead_letters(task_id, session_id, reason) SELECT 'seed', 'seed', 'seed' WHERE 0`).run();
    return true;
  } catch (_e) {
    return false;
  }
}
