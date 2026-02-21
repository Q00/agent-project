// Phase 2-3: Operational Metrics
import { nowIso } from './db.js';

export function buildMetrics({ db, sinceMinutes = 60 }) {
  const now = nowIso();
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

  // Lock expired count
  const lockExpired = db.prepare(`
    SELECT COUNT(*) AS c
    FROM session_state
    WHERE lock_expires_at < ? AND status IN ('running', 'waiting')
  `).get(now).c;

  // Stale recovered count
  const staleRecovered = db.prepare(`
    SELECT COUNT(*) AS c
    FROM event_log
    WHERE event_type = 'session_stale' AND created_at >= ?
  `).get(since).c;

  // Duplicate suppressed count
  const duplicateSuppressed = db.prepare(`
    SELECT COUNT(*) AS c
    FROM event_log
    WHERE event_type = 'task_claimed'
    AND status = 'ok'
    AND payload LIKE '%dupe_or_owned%'
    AND created_at >= ?
  `).get(since).c;

  // Retry attempts count
  const retryAttempts = db.prepare(`
    SELECT COUNT(*) AS c
    FROM task_queue
    WHERE retry_count > 0
  `).get().c;

  // Retry limit reached count
  const retryLimitReached = db.prepare(`
    SELECT COUNT(*) AS c
    FROM task_queue
    WHERE retry_count >= 3
  `).get().c;

  // Event aggregation
  const eventAgg = db.prepare(`
    SELECT event_type, COUNT(*) AS c
    FROM event_log
    WHERE created_at >= ?
    GROUP BY event_type
    ORDER BY c DESC
  `).all(since);

  return {
    windowMinutes: sinceMinutes,
    at: now,
    lockExpired: Number(lockExpired || 0),
    staleRecovered: Number(staleRecovered || 0),
    duplicateSuppressed: Number(duplicateSuppressed || 0),
    retryAttempts: Number(retryAttempts || 0),
    retryLimitReached: Number(retryLimitReached || 0),
    eventAgg
  };
}
