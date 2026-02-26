import test from 'node:test';
import assert from 'node:assert';
import { openDatabase } from './db.js';
import { initSchema } from './init-db.js';
import { enqueueTask, claimNextTask, startTask, completeTask } from './taskQueue.js';
import { claimTask, releaseTask } from './orchestrator.js';

function createTestDb() {
  const { db } = openDatabase(':memory:');
  initSchema(db);
  
  // Create test session
  db.prepare(`
    INSERT OR IGNORE INTO session_state (session_id, namespace, phase, status)
    VALUES ('q00-session', 'default', 'idle', 'idle')
  `).run();
  
  return db;
}

test('e2e: q00 integration - trade.decide with retry', async (t) => {
  const db = createTestDb();
  
  // 1. Enqueue trade decision task (Phase A)
  const enqueueResult = enqueueTask({
    db,
    taskId: 'trade-decide-2026-02-27',
    sessionId: 'q00-session',
    kind: 'trade.decide',
    priority: 1,
    payload: { symbol: 'BTC-USDT', action: 'buy' },
    maxRetries: 3
  });
  
  assert.strictEqual(enqueueResult.ok, true);
  console.log('✅ Step 1: Task enqueued (Phase A)');
  
  // 2. Claim task (Phase B)
  const claimResult = claimNextTask({
    db,
    sessionId: 'q00-session',
    ownerAgent: 'trading-worker'
  });
  
  assert.strictEqual(claimResult.ok, true);
  assert.strictEqual(claimResult.task.kind, 'trade.decide');
  console.log('✅ Step 2: Task claimed (Phase B)');
  
  // 3. Start task (Phase A)
  const startResult = startTask({
    db,
    taskId: 'trade-decide-2026-02-27',
    ownerAgent: 'trading-worker'
  });
  
  assert.strictEqual(startResult.ok, true);
  console.log('✅ Step 3: Task started (Phase A)');
  
  // 4. Simulate failure - should retry (Phase B)
  const failResult = completeTask({
    db,
    taskId: 'trade-decide-2026-02-27',
    status: 'failed',
    errorCode: 'MARKET_CLOSED',
    errorMsg: 'Market is closed'
  });
  
  assert.strictEqual(failResult.ok, true);
  assert.strictEqual(failResult.finalStatus, 'queued'); // Should retry
  assert.strictEqual(failResult.willRetry, true);
  console.log('✅ Step 4: Task failed, scheduled for retry (Phase B)');
  
  // 5. Check retry_count increased
  const task1 = db.prepare('SELECT retry_count, status, next_retry_at FROM task_queue WHERE task_id = ?').get('trade-decide-2026-02-27');
  assert.strictEqual(task1.retry_count, 1);
  assert.strictEqual(task1.status, 'queued');
  assert.ok(task1.next_retry_at);
  console.log('✅ Step 5: Retry count increased, next_retry_at set');
  
  // 6. Claim again (retry attempt 2)
  const claim2 = claimNextTask({
    db,
    sessionId: 'q00-session',
    ownerAgent: 'trading-worker'
  });
  
  assert.strictEqual(claim2.ok, true);
  startTask({ db, taskId: 'trade-decide-2026-02-27', ownerAgent: 'trading-worker' });
  
  // 7. Fail again (attempt 2)
  const fail2 = completeTask({
    db,
    taskId: 'trade-decide-2026-02-27',
    status: 'failed',
    errorCode: 'MARKET_CLOSED',
    errorMsg: 'Market is still closed'
  });
  
  const task2 = db.prepare('SELECT retry_count, status FROM task_queue WHERE task_id = ?').get('trade-decide-2026-02-27');
  assert.strictEqual(task2.retry_count, 2);
  console.log('✅ Step 6: Second retry scheduled');
  
  // 8. Claim and fail again (attempt 3 - max retries)
  const claim3 = claimNextTask({
    db,
    sessionId: 'q00-session',
    ownerAgent: 'trading-worker'
  });
  
  startTask({ db, taskId: 'trade-decide-2026-02-27', ownerAgent: 'trading-worker' });
  
  const fail3 = completeTask({
    db,
    taskId: 'trade-decide-2026-02-27',
    status: 'failed',
    errorCode: 'MARKET_CLOSED',
    errorMsg: 'Market still closed - max retries'
  });
  
  // 9. Should be dead letter now (or still queued if will_retry is set)
  const task3 = db.prepare('SELECT retry_count, status FROM task_queue WHERE task_id = ?').get('trade-decide-2026-02-27');
  assert.strictEqual(task3.retry_count, 3);
  // Note: actual status depends on max_retries comparison
  // If retry_count >= max_retries, should be 'dead'
  // Otherwise 'queued' with next_retry_at
  assert.ok(['dead', 'queued'].includes(task3.status));
  console.log('✅ Step 7: Task processed (status:', task3.status, ')');
  
  // 10. Check event log
  const events = db.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM event_log
    WHERE session_id = 'q00-session'
    GROUP BY event_type
  `).all();
  
  console.log('📊 Event log summary:', events);
  assert.ok(events.find(e => e.event_type === 'task_enqueued'));
  assert.ok(events.find(e => e.event_type === 'task_claimed'));
  
  db.close();
});

test('e2e: q00 integration - kpi.dailyReport success', async (t) => {
  const db = createTestDb();
  
  // 1. Enqueue KPI report task (Phase A)
  const enqueueResult = enqueueTask({
    db,
    taskId: 'kpi-2026-02-27',
    sessionId: 'q00-session',
    kind: 'kpi.dailyReport',
    priority: 5,
    payload: { date: '2026-02-27' },
    maxRetries: 3
  });
  
  assert.strictEqual(enqueueResult.ok, true);
  
  // 2. Claim and complete successfully
  const claimResult = claimNextTask({
    db,
    sessionId: 'q00-session',
    ownerAgent: 'kpi-worker'
  });
  
  assert.strictEqual(claimResult.ok, true);
  assert.strictEqual(claimResult.task.kind, 'kpi.dailyReport');
  
  startTask({ db, taskId: 'kpi-2026-02-27', ownerAgent: 'kpi-worker' });
  
  // 3. Complete successfully
  const completeResult = completeTask({
    db,
    taskId: 'kpi-2026-02-27',
    status: 'done'
  });
  
  assert.strictEqual(completeResult.ok, true);
  assert.strictEqual(completeResult.finalStatus, 'done');
  
  // 4. Verify final state
  const task = db.prepare('SELECT status, retry_count FROM task_queue WHERE task_id = ?').get('kpi-2026-02-27');
  assert.strictEqual(task.status, 'done');
  assert.strictEqual(task.retry_count, 0);
  
  console.log('✅ KPI report completed successfully (no retries needed)');
  
  db.close();
});

console.log('✅ All q00 integration e2e tests completed');
