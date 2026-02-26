import test from 'node:test';
import assert from 'node:assert';
import { openDatabase } from './db.js';
import { initSchema } from './init-db.js';
import { 
  enqueueTask, 
  claimNextTask, 
  startTask, 
  completeTask 
} from './taskQueue.js';

function createTestDb() {
  const { db } = openDatabase(':memory:');
  initSchema(db);
  
  // Create test session (ignore if exists)
  db.prepare(`
    INSERT OR IGNORE INTO session_state (session_id, namespace, phase, status)
    VALUES ('test-session', 'default', 'idle', 'idle')
  `).run();
  
  return db;
}

test('enqueue → claim → complete flow', async (t) => {
  const db = createTestDb();
  
  // 1. Enqueue task
  const enqueueResult = enqueueTask({
    db,
    taskId: 'test-task-1',
    sessionId: 'test-session',
    kind: 'test.action',
    priority: 5,
    payload: { test: true }
  });
  
  assert.strictEqual(enqueueResult.ok, true);
  assert.strictEqual(enqueueResult.taskId, 'test-task-1');
  
  // 2. Claim task
  const claimResult = claimNextTask({
    db,
    sessionId: 'test-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claimResult.ok, true);
  assert.strictEqual(claimResult.task.taskId, 'test-task-1');
  assert.strictEqual(claimResult.task.kind, 'test.action');
  
  // 3. Start task
  const startResult = startTask({
    db,
    taskId: 'test-task-1',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(startResult.ok, true);
  
  // 4. Complete task
  const completeResult = completeTask({
    db,
    taskId: 'test-task-1',
    status: 'done'
  });
  
  assert.strictEqual(completeResult.ok, true);
  assert.strictEqual(completeResult.finalStatus, 'done');
  
  // Verify final state
  const task = db.prepare('SELECT status FROM task_queue WHERE task_id = ?').get('test-task-1');
  assert.strictEqual(task.status, 'done');
  
  db.close();
});

test('priority ordering', async (t) => {
  const db = createTestDb();
  
  // Enqueue tasks with different priorities
  enqueueTask({
    db,
    taskId: 'low-priority',
    sessionId: 'test-session',
    kind: 'test.action',
    priority: 10
  });
  
  enqueueTask({
    db,
    taskId: 'high-priority',
    sessionId: 'test-session',
    kind: 'test.action',
    priority: 1
  });
  
  enqueueTask({
    db,
    taskId: 'medium-priority',
    sessionId: 'test-session',
    kind: 'test.action',
    priority: 5
  });
  
  // Claim should get highest priority (lowest number)
  const claim1 = claimNextTask({
    db,
    sessionId: 'test-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claim1.ok, true);
  assert.strictEqual(claim1.task.taskId, 'high-priority');
  
  // Complete first task
  startTask({ db, taskId: 'high-priority', ownerAgent: 'test-agent' });
  completeTask({ db, taskId: 'high-priority', status: 'done' });
  
  // Claim next (should be medium)
  const claim2 = claimNextTask({
    db,
    sessionId: 'test-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claim2.ok, true);
  assert.strictEqual(claim2.task.taskId, 'medium-priority');
  
  // Complete second task
  startTask({ db, taskId: 'medium-priority', ownerAgent: 'test-agent' });
  completeTask({ db, taskId: 'medium-priority', status: 'done' });
  
  // Claim next (should be low)
  const claim3 = claimNextTask({
    db,
    sessionId: 'test-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claim3.ok, true);
  assert.strictEqual(claim3.task.taskId, 'low-priority');
  
  db.close();
});

test('dedupe_key prevents duplicates', async (t) => {
  const db = createTestDb();
  
  // Enqueue with dedupe_key
  const result1 = enqueueTask({
    db,
    taskId: 'original-task',
    sessionId: 'test-session',
    kind: 'test.action',
    dedupeKey: 'unique-key-123'
  });
  
  assert.strictEqual(result1.ok, true);
  
  // Try to enqueue again with same dedupe_key
  const result2 = enqueueTask({
    db,
    taskId: 'duplicate-task',
    sessionId: 'test-session',
    kind: 'test.action',
    dedupeKey: 'unique-key-123'
  });
  
  assert.strictEqual(result2.ok, false);
  assert.strictEqual(result2.reason, 'duplicate');
  assert.strictEqual(result2.taskId, 'original-task'); // Returns existing task
  
  // Verify only one task in queue
  const count = db.prepare(`
    SELECT COUNT(*) as count FROM task_queue WHERE session_id = 'test-session'
  `).get().count;
  
  assert.strictEqual(count, 1);
  
  db.close();
});

test('dead letter on max retries exceeded', async (t) => {
  const db = createTestDb();
  
  // Enqueue task with max_retries=2
  const enqueueResult = enqueueTask({
    db,
    taskId: 'failing-task',
    sessionId: 'test-session',
    kind: 'test.action',
    maxRetries: 2
  });
  
  assert.strictEqual(enqueueResult.ok, true);
  
  // Claim and start task
  const claimResult = claimNextTask({
    db,
    sessionId: 'test-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claimResult.ok, true);
  
  startTask({ db, taskId: 'failing-task', ownerAgent: 'test-agent' });
  
  // Fail task (retry_count=0, max_retries=2, should retry)
  const fail1 = completeTask({
    db,
    taskId: 'failing-task',
    status: 'failed',
    errorCode: 'TEST_ERROR',
    errorMsg: 'First failure'
  });
  
  assert.strictEqual(fail1.ok, true);
  assert.strictEqual(fail1.finalStatus, 'queued'); // Should retry
  assert.strictEqual(fail1.willRetry, true);
  
  // Manually increment retry_count and fail again
  db.prepare('UPDATE task_queue SET retry_count = 2 WHERE task_id = ?').run('failing-task');
  
  // Claim again
  const claim2 = claimNextTask({
    db,
    sessionId: 'test-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claim2.ok, true);
  assert.strictEqual(claim2.task.retryCount, 2);
  
  startTask({ db, taskId: 'failing-task', ownerAgent: 'test-agent' });
  
  // Fail again (retry_count >= max_retries, should become dead)
  const fail2 = completeTask({
    db,
    taskId: 'failing-task',
    status: 'failed',
    errorCode: 'FINAL_ERROR',
    errorMsg: 'Max retries exceeded'
  });
  
  assert.strictEqual(fail2.ok, true);
  assert.strictEqual(fail2.finalStatus, 'dead');
  
  // Verify task is dead
  const task = db.prepare('SELECT status FROM task_queue WHERE task_id = ?').get('failing-task');
  assert.strictEqual(task.status, 'dead');
  
  db.close();
});

test('no tasks available returns appropriate error', async (t) => {
  const db = createTestDb();
  
  const claimResult = claimNextTask({
    db,
    sessionId: 'empty-session',
    ownerAgent: 'test-agent'
  });
  
  assert.strictEqual(claimResult.ok, false);
  assert.strictEqual(claimResult.reason, 'no_tasks');
  
  db.close();
});

console.log('✅ All Task Queue tests passed');
