// Phase 2-3/2-4: Operational Metrics + threshold alerts
import { nowIso } from './db.js';
import { evaluateThresholds as evaluateThresholdsBase } from './alert_rules.js';

function toNumber(v) {
  return Number(v || 0);
}

function safeCount(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params).c;
  } catch (_e) {
    return 0;
  }
}

export function buildMetrics({ db, sinceMinutes = 60 }) {
  const now = nowIso();
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

  // Lock expired count
  const lockExpired = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM session_state
    WHERE lock_expires_at < ? AND status IN ('running', 'waiting')
  `, [now]);

  // Stale recovered count
  const staleRecovered = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM event_log
    WHERE event_type = 'session_stale'
      AND status = 'ok'
      AND created_at >= ?
  `, [since]);

  // Stale recovery failed count
  const staleRecoveryFailed = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM event_log
    WHERE event_type = 'session_stale'
      AND status != 'ok'
      AND created_at >= ?
  `, [since]);

  // Duplicate suppressed count
  const duplicateSuppressed = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM event_log
    WHERE event_type = 'task_claimed'
    AND status = 'ok'
    AND payload LIKE '%dupe_or_owned%'
    AND created_at >= ?
  `, [since]);

  // Retry attempts count
  const retryAttempts = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM task_queue
    WHERE retry_count > 0
  `);

  // Retry limit reached count
  const retryLimitReached = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM task_queue
    WHERE retry_count >= 3
  `);

  // Dead-letter open count
  const deadLettersOpen = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM dead_letters
    WHERE status='open'
      AND created_at >= ?
  `, [since]);

  // Lock conflict events
  const lockConflictEvents = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM lock_events
    WHERE event_type IN ('lock_miss_or_conflict', 'lock_takeover_failed', 'heartbeat_lock_mismatch', 'release_lock_mismatch', 'stale_recovery_failed')
      AND created_at >= ?
  `, [since]);

  // Potential orphan lock candidates tracked in monitor and metric channel
  const orphanedLocks = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM distributed_lock l
    WHERE NOT EXISTS (
      SELECT 1 FROM session_state s
      WHERE l.lock_key = ('session:' || s.session_id || ':lock')
    )
  `);

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
    lockExpired: toNumber(lockExpired),
    staleRecovered: toNumber(staleRecovered),
    staleRecoveryFailed: toNumber(staleRecoveryFailed),
    duplicateSuppressed: toNumber(duplicateSuppressed),
    retryAttempts: toNumber(retryAttempts),
    retryLimitReached: toNumber(retryLimitReached),
    deadLettersOpen: toNumber(deadLettersOpen),
    lockConflictEvents: toNumber(lockConflictEvents),
    orphanedLocks: toNumber(orphanedLocks),
    eventAgg,
  };
}

export function evaluateThresholds(metrics, thresholds = {}) {
  return evaluateThresholdsBase(metrics, thresholds);
}
