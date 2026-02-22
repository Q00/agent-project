// Phase 2-4: lock conflict / mis-claim monitor and auto-recovery

import { nowIso } from './db.js';
import { evaluateThresholds } from './alert_rules.js';
import { logLockEvent } from './ops.js';

function parseWindowMinutes(windowMinutes) {
  const n = Number(windowMinutes);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function safeCount(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params).c;
  } catch (_e) {
    return 0;
  }
}

function ensureLockEventsTables(db) {
  const ok = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lock_events'").get();
  return Boolean(ok);
}

function ensureAlertsTable(db) {
  const ok = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'").get();
  return Boolean(ok);
}

function ensureDistributedLockTable(db) {
  const ok = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='distributed_lock'").get();
  return Boolean(ok);
}

function insertAlert(db, alert) {
  if (!ensureAlertsTable(db)) return false;
  try {
    const result = db.prepare(`
      INSERT INTO alerts(alert_key, level, value, threshold, source, message)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(alert.key, alert.level, alert.value, alert.threshold, alert.source || 'lock_monitor', alert.message);
    return result.changes > 0;
  } catch (_e) {
    return false;
  }
}

function orphanedLocks(db, now, staleMs = 120000) {
  if (!ensureDistributedLockTable(db)) return [];
  return db.prepare(`
    SELECT l.lock_key,
           l.owner_token,
           l.owner_agent,
           l.expires_at,
           s.session_id,
           s.lock_token,
           s.lock_expires_at
    FROM distributed_lock l
    LEFT JOIN session_state s
      ON l.lock_key = ('session:' || s.session_id || ':lock')
    WHERE (s.session_id IS NULL
           OR s.status NOT IN ('running', 'waiting')
           OR l.owner_token <> COALESCE(s.lock_token, ''))
      AND datetime(l.expires_at) < datetime(?)
      AND CAST((julianday(?) - julianday(l.acquired_at)) * 86400 * 1000 AS INTEGER) > ?
  `).all(nowIso(), now, staleMs);
}

export function buildLockHealthMetrics(db, windowMinutes = 60) {
  const since = new Date(Date.now() - parseWindowMinutes(windowMinutes) * 60 * 1000).toISOString();
  const now = nowIso();

  const lockEvents = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM lock_events
    WHERE event_type IN ('lock_miss_or_conflict', 'lock_takeover_failed', 'heartbeat_lock_mismatch', 'release_lock_mismatch')
      AND created_at >= ?
  `, [since]);

  const orphanCount = safeCount(db, `
    SELECT COUNT(*) AS c
    FROM distributed_lock l
    WHERE NOT EXISTS (
      SELECT 1 FROM session_state s
      WHERE l.lock_key = ('session:' || s.session_id || ':lock')
    )
  `);

  const staleOrphanCount = orphanedLocks(db, now, 120000).length;

  return {
    windowMinutes: parseWindowMinutes(windowMinutes),
    now,
    lockConflictEvents: lockEvents,
    orphanedLocks: orphanCount,
    staleOrphanLocks: staleOrphanCount,
  };
}

function dedupeAlertInsert(db, alertKey, windowMinutes = 60) {
  if (!ensureAlertsTable(db)) return false;
  const since = new Date(Date.now() - parseWindowMinutes(windowMinutes) * 60 * 1000).toISOString();
  const exists = db.prepare(`
    SELECT alert_id
    FROM alerts
    WHERE alert_key = ? AND resolved_at IS NULL AND created_at >= ?
  `).get(alertKey, since);
  return !exists;
}

export function runLockMonitor({ db, thresholdOverrides = {}, actor = 'watchdog', windowMinutes = 60, autoRecover = true }) {
  const metrics = buildLockHealthMetrics(db, windowMinutes);
  const { alerts } = evaluateThresholds(metrics, thresholdOverrides);
  const filtered = alerts.filter((a) => ['orphanedLocks', 'lockConflictEvents'].includes(a.key));

  if (ensureLockEventsTables(db)) {
    for (const candidate of orphanedLocks(db, nowIso(), 120000)) {
      logLockEvent({
        db,
        lockKey: candidate.lock_key,
        sessionId: candidate.session_id || null,
        eventType: 'lock_orphan_recovered',
        actor,
        payload: {
          ownerToken: candidate.owner_token,
          ownerAgent: candidate.owner_agent,
          reason: 'orphaned_lock_without_session',
        },
      });

      if (autoRecover) {
        db.prepare('DELETE FROM distributed_lock WHERE lock_key=?').run(candidate.lock_key);
      }
    }
  }

  const persisted = [];
  for (const alert of filtered) {
    if (!dedupeAlertInsert(db, alert.key, windowMinutes)) continue;
    insertAlert(db, { ...alert, source: actor });
    persisted.push(alert);
  }

  return {
    metrics,
    alerts: filtered,
    persistedAlerts: persisted,
    recoveredLocks: autoRecover ? staleOrphanCount(db, nowIso()) : 0,
  };
}

function staleOrphanCount(db, now) {
  return orphanedLocks(db, now, 120000).length;
}
