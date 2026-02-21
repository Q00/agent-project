// Phase 2-3: Metrics Tests
import { openDatabase } from './db.js';
import { buildMetrics } from './metrics.js';

const { db } = openDatabase();

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

function setupSeed() {
  // Clear existing data
  db.prepare("DELETE FROM task_queue").run();
  db.prepare("DELETE FROM event_log").run();
  db.prepare("DELETE FROM distributed_lock").run();
  db.prepare("DELETE FROM session_state").run();
}

setupSeed();

// Seed test data
db.prepare("INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at) VALUES(?,?,?,?,?,?)")
  .run('s1', 'default', 'running', 'running', new Date().toISOString(), new Date().toISOString());

db.prepare("INSERT INTO task_queue(task_id, session_id, task_type, status, retry_count) VALUES(?,?,?,?,?)")
  .run('t1', 's1', 'test-task', 'running', 2);

db.prepare("INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, payload, status) VALUES(?,?,?,?,?,?)")
  .run('s1', 1, 'session_stale', 'watchdog', '{}', 'ok');

db.prepare("INSERT INTO event_log(session_id, event_seq, event_type, actor_agent, payload, status) VALUES(?,?,?,?,?,?)")
  .run('s1', 2, 'task_claimed', 'agent-a', '{"reason":"dupe_or_owned"}', 'ok');

// Build metrics
const m = buildMetrics({ db, sinceMinutes: 120 });

// Assertions
assert(m.staleRecovered >= 1, 'staleRecovered');
assert(m.retryAttempts >= 1, 'retryAttempts');
assert(m.duplicateSuppressed >= 1, 'duplicateSuppressed');

db.close();
console.log('All Phase 2-3 metrics tests passed ✅');
