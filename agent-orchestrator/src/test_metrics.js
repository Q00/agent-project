// Phase 2-3/2-4: Metrics Tests
import { openDatabase } from './db.js';
import { buildMetrics, evaluateThresholds } from './metrics.js';

const { db } = openDatabase();

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

function setupSeed() {
  // Clear existing data
  db.prepare('DELETE FROM task_queue').run();
  db.prepare('DELETE FROM event_log').run();
  db.prepare('DELETE FROM distributed_lock').run();
  db.prepare('DELETE FROM session_state').run();

  const hasDeadLetters = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dead_letters'").get();
  const hasLockEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lock_events'").get();
  const hasAlerts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alerts'").get();
  if (hasDeadLetters) db.prepare('DELETE FROM dead_letters').run();
  if (hasLockEvents) db.prepare('DELETE FROM lock_events').run();
  if (hasAlerts) db.prepare('DELETE FROM alerts').run();
}

setupSeed();

// Seed test data
db.prepare('INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at) VALUES(?,?,?,?,?,?)')
  .run('s1', 'default', 'running', 'running', new Date().toISOString(), new Date().toISOString());

db.prepare('INSERT INTO task_queue(task_id, session_id, task_type, status, retry_count) VALUES(?,?,?,?,?)')
  .run('t1', 's1', 'test-task', 'running', 2);

db.prepare('INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, payload, status) VALUES(?,?,?,?,?,?)')
  .run('s1', 1, 'session_stale', 'watchdog', '{}', 'ok');

db.prepare('INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, payload, status) VALUES(?,?,?,?,?,?)')
  .run('s1', 2, 'session_stale', 'watchdog', '{"reason":"recover-failed"}', 'error');

db.prepare('INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, payload, status) VALUES(?,?,?,?,?,?)')
  .run('s1', 3, 'task_claimed', 'agent-a', '{"reason":"dupe_or_owned"}', 'ok');

// Build metrics
const m = buildMetrics({ db, sinceMinutes: 120 });

// Assertions
assert(m.staleRecovered >= 1, 'staleRecovered');
assert(m.staleRecoveryFailed >= 1, 'staleRecoveryFailed');
assert(m.retryAttempts >= 1, 'retryAttempts');
assert(m.duplicateSuppressed >= 1, 'duplicateSuppressed');

const { alerts, staleFailureRate } = evaluateThresholds(m, {
  retryAttempts: 1,
  retryLimitReached: 0,
  lockExpired: 999,
  duplicateSuppressed: 0,
  staleRecoveryFailureRate: 0.4,
});

assert(alerts.length >= 2, 'alert count');
assert(staleFailureRate > 0, 'staleRecoveryFailureRate');

const hasDuplicateAlert = alerts.some((a) => a.key === 'duplicateSuppressed');
const hasFailureRateAlert = alerts.some((a) => a.key === 'staleRecoveryFailureRate');
assert(hasDuplicateAlert, 'duplicateSuppressed alert');
assert(hasFailureRateAlert, 'staleRecoveryFailureRate alert');

db.close();
console.log('All Phase 2-3/2-4 metrics tests passed ✅');
