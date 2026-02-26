import { openDatabase } from './db.js';
import { claimTask, releaseTask, LOCK_TTL_MS, HEARTBEAT_MS } from './orchestrator.js';
import { staleRecovery } from './staleRecovery.js';

const { db } = openDatabase();
function seed(sessionId) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM task_queue WHERE session_id=?').run(sessionId);
  db.prepare('DELETE FROM event_log WHERE session_id=?').run(sessionId);
  db.prepare('DELETE FROM distributed_lock WHERE lock_key=?').run(`session:${sessionId}:lock`);
  db.prepare('DELETE FROM session_state WHERE session_id=?').run(sessionId);
  db.prepare("INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at) VALUES(?, 'default', 'idle', 'idle', ?, ?)")
    .run(sessionId, now, now);
  db.prepare("INSERT INTO task_queue(task_id, session_id, task_type, payload) VALUES(?, ?, 'typeA', '{\"foo\":\"bar\"}')")
    .run(`task-${sessionId}`, sessionId);
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`FAIL: ${msg}`);
  }
}

function countDeadLetters(taskId) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM dead_letters WHERE task_id=?').get(taskId).c);
}

// 1) retry path: failure -> queued, retry_count increments
seed('phase-b-smoke-1');
const claimed = claimTask({ db, sessionId: 'phase-b-smoke-1', agent: 'agent-a' });
assert(claimed.ok, 'claim task');
const failed = releaseTask({
  db,
  sessionId: 'phase-b-smoke-1',
  taskId: claimed.taskId,
  lockToken: claimed.lockToken,
  agent: 'agent-a',
  result: { ok: false, errorCode: 'E_TEMP', errorMsg: 'temporary retry needed' }
});
assert(failed.ok, 'release failed task ok');
assert(failed.retries === 1, 'retry count should be incremented to 1');
const afterRetry = db.prepare("SELECT status, retry_count, next_retry_at FROM task_queue WHERE task_id=?").get(claimed.taskId);
assert(afterRetry.status === 'queued', 'failed task should be queued');
assert(Number(afterRetry.retry_count) === 1, 'task row retry_count should be 1');
assert(afterRetry.next_retry_at != null, 'retry timestamp should be set');

// 2) dead letter when max retries reached
seed('phase-b-smoke-2');
const claimed2 = claimTask({ db, sessionId: 'phase-b-smoke-2', agent: 'agent-b' });
assert(claimed2.ok, 'claim task for dead-letter simulation');
// force terminal retry state and trigger dead-letter on next failure
const dueNow = new Date(Date.now() - 1000).toISOString();
db.prepare("UPDATE task_queue SET retry_count=?, status='queued', next_retry_at=?, owner_agent=NULL, owner_agent=? WHERE task_id=?").run(3, dueNow, null, claimed2.taskId);
const dead = releaseTask({
  db,
  sessionId: 'phase-b-smoke-2',
  taskId: claimed2.taskId,
  lockToken: claimed2.lockToken,
  agent: 'agent-b',
  result: { ok: false, errorCode: 'E_FAIL', errorMsg: 'retry exhausted' }
});
assert(dead.ok, 'release exhausted task ok');
const deadRow = db.prepare("SELECT status, retry_count FROM task_queue WHERE task_id=?").get(claimed2.taskId);
assert(deadRow.status === 'failed', 'task should end as failed');
assert(Number(deadRow.retry_count) >= 4, 'retry_count should be incremented on terminal failure');
assert(countDeadLetters(claimed2.taskId) >= 1, 'dead letter should be recorded');

// 3) stale recovery path remains intact
seed('phase-b-smoke-3');
const claimed3 = claimTask({ db, sessionId: 'phase-b-smoke-3', agent: 'agent-c' });
assert(claimed3.ok, 'claim task for stale test');
const staleAt = new Date(Date.now() - HEARTBEAT_MS * 3).toISOString();
db.prepare("UPDATE session_state SET heartbeat_at=?, status='running', lock_expires_at=? WHERE session_id=?").run(staleAt, staleAt, 'phase-b-smoke-3');
const recovery = staleRecovery({ db, agent: 'watchdog' });
assert(recovery.recovered >= 1, 'stale recovery should recover task');

console.log('✅ Phase B smoke test passed');
db.close();
