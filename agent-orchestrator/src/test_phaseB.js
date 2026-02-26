import test from 'node:test';
import assert from 'node:assert';
import { openDatabase } from './db.js';
import { initSchema } from './init-db.js';
import { 
  claimTask, 
  releaseTask, 
  heartbeat
} from './orchestrator.js';

function createTestDb() {
  const { db } = openDatabase(':memory:');
  initSchema(db);
  
  // Create test session
  db.prepare(`
    INSERT OR IGNORE INTO session_state (session_id, namespace, phase, status)
    VALUES ('test-session', 'default', 'idle', 'idle')
  `).run();
  
  return db;
}

test('Phase B: retry logic with next_retry_at', async (t) => {
  const db = createTestDb();
  
  // 1. Create task in task_queue
  db.prepare(`
    INSERT INTO task_queue (
      task_id, session_id, task_type, priority, payload, status,
      retry_count, max_retries, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, ?)
  `).run('retry-task-1', 'test-session', 'test.action', 5, '{}', new Date().toISOString());
  
  // 2. Claim task
  const claimResult = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'test-agent'
  });
  
  assert.strictEqual(claimResult.ok, true);
  assert.strictEqual(claimResult.taskId, 'retry-task-1');
  
  // 3. Fail task (first attempt)
  const release1 = releaseTask({
    db,
    sessionId: 'test-session',
    taskId: 'retry-task-1',
    lockToken: claimResult.lockToken,
    result: { ok: false, error: 'First failure' },
    agent: 'test-agent'
  });
  
  assert.strictEqual(release1.ok, true);
  
  // 4. Check retry_count increased
  const task1 = db.prepare('SELECT retry_count, status, next_retry_at FROM task_queue WHERE task_id = ?').get('retry-task-1');
  assert.strictEqual(task1.retry_count, 1);
  assert.strictEqual(task1.status, 'queued'); // Should be queued for retry
  assert.ok(task1.next_retry_at); // Should have next_retry_at
  
  // 5. Claim again (retry)
  const claim2 = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'test-agent'
  });
  
  assert.strictEqual(claim2.ok, true);
  assert.strictEqual(claim2.taskId, 'retry-task-1');
  
  // 6. Fail again (second attempt)
  const release2 = releaseTask({
    db,
    sessionId: 'test-session',
    taskId: 'retry-task-1',
    lockToken: claim2.lockToken,
    result: { ok: false, error: 'Second failure' },
    agent: 'test-agent'
  });
  
  assert.strictEqual(release2.ok, true);
  
  // 7. Check retry_count increased again
  const task2 = db.prepare('SELECT retry_count, status FROM task_queue WHERE task_id = ?').get('retry-task-1');
  assert.strictEqual(task2.retry_count, 2);
  assert.strictEqual(task2.status, 'queued'); // Still queued
  
  // 8. Claim and fail third time (max_retries=3)
  const claim3 = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'test-agent'
  });
  
  const release3 = releaseTask({
    db,
    sessionId: 'test-session',
    taskId: 'retry-task-1',
    lockToken: claim3.lockToken,
    result: { ok: false, error: 'Third failure - max retries' },
    agent: 'test-agent'
  });
  
  // 9. Should be dead letter now
  const task3 = db.prepare('SELECT retry_count, status FROM task_queue WHERE task_id = ?').get('retry-task-1');
  assert.strictEqual(task3.retry_count, 3);
  assert.strictEqual(task3.status, 'dead'); // Max retries exceeded
  
  db.close();
});

test('Phase B: lock contention + takeover', async (t) => {
  const db = createTestDb();
  
  // 1. Create task
  db.prepare(`
    INSERT INTO task_queue (
      task_id, session_id, task_type, priority, payload, status,
      retry_count, max_retries, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, ?)
  `).run('contention-task', 'test-session', 'test.action', 5, '{}', new Date().toISOString());
  
  // 2. First agent claims task
  const claim1 = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'agent-1'
  });
  
  assert.strictEqual(claim1.ok, true);
  
  // 3. Second agent tries to claim (should fail)
  const claim2 = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'agent-2'
  });
  
  assert.strictEqual(claim2.ok, false);
  assert.strictEqual(claim2.reason, 'busy');
  
  // 4. Expire lock manually
  db.prepare(`
    UPDATE distributed_lock 
    SET expires_at = datetime('now', '-1 minute')
    WHERE lock_key = ?
  `).run(`task:test-session`);
  
  // 5. Second agent retries (should takeover)
  const claim3 = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'agent-2'
  });
  
  assert.strictEqual(claim3.ok, true);
  assert.strictEqual(claim3.takeover, true);
  
  db.close();
});

test('Phase B: queued state support', async (t) => {
  const db = createTestDb();
  
  // 1. Create task in queued state (retry scenario)
  db.prepare(`
    INSERT INTO task_queue (
      task_id, session_id, task_type, priority, payload, status,
      retry_count, max_retries, created_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', 1, 3, ?)
  `).run('queued-task', 'test-session', 'test.action', 5, '{}', new Date().toISOString());
  
  // 2. Claim should work with queued state
  const claim = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'test-agent'
  });
  
  assert.strictEqual(claim.ok, true);
  assert.strictEqual(claim.taskId, 'queued-task');
  
  // 3. Complete successfully
  const release = releaseTask({
    db,
    sessionId: 'test-session',
    taskId: 'queued-task',
    lockToken: claim.lockToken,
    result: { ok: true },
    agent: 'test-agent'
  });
  
  assert.strictEqual(release.ok, true);
  
  // 4. Check final status
  const task = db.prepare('SELECT status, retry_count FROM task_queue WHERE task_id = ?').get('queued-task');
  assert.strictEqual(task.status, 'done');
  
  db.close();
});

test('Phase B: event idempotency with lock token', async (t) => {
  const db = createTestDb();
  
  // 1. Create task
  db.prepare(`
    INSERT INTO task_queue (
      task_id, session_id, task_type, priority, payload, status,
      retry_count, max_retries, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, ?)
  `).run('idempotent-task', 'test-session', 'test.action', 5, '{}', new Date().toISOString());
  
  // 2. Claim task
  const claim1 = claimTask({
    db,
    sessionId: 'test-session',
    taskTypeFilter: 'test.action',
    agent: 'test-agent'
  });
  
  assert.strictEqual(claim1.ok, true);
  
  // 3. Try to claim again with same lock token (should handle gracefully)
  // This simulates a retry scenario
  
  // Check event_log for idempotency
  const events = db.prepare(`
    SELECT * FROM event_log 
    WHERE session_id = ? AND event_type = 'task_claimed'
    ORDER BY event_seq DESC
  `).all('test-session');
  
  assert.ok(events.length > 0);
  assert.ok(events[0].idempotency_key.includes('task-claim'));
  
  db.close();
});

console.log('✅ All Phase B tests completed');
