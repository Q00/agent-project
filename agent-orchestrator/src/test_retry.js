// Retry Policy Tests
// Phase 2-2: Resilience layer tests

import { openDatabase } from './db.js';
import { executeWithRetry, isRetryable, shouldRetry, getNextRetryAt, RETRYABLE_ERROR_CODES } from './retryPolicy.js';

const { db, dbPath } = openDatabase();
function log(msg) { console.log(msg); }

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

async function run() {
  log(`Using db: ${dbPath}`);
  log('--- Retry Policy Tests ---');

  // Test 1: isRetryable detection
  log('Test 1: isRetryable detection');
  
  const retryableErrors = [
    { code: 'ECONNRESET', expected: true },
    { code: 'ETIMEDOUT', expected: true },
    { code: 'SQLITE_BUSY', expected: true },
    { code: 'EINVAL', expected: false },
    { message: 'Connection timeout', expected: true },
    { message: 'Invalid argument', expected: false }
  ];

  for (const { code, message, expected } of retryableErrors) {
    const error = code ? { code } : { message };
    const result = isRetryable(error);
    assert(result === expected, `isRetryable(${code || message})`);
  }
  log('✅ Test 1 passed');

  // Test 2: executeWithRetry success
  log('Test 2: executeWithRetry success');
  
  let callCount = 0;
  const successFn = () => {
    callCount++;
    return { value: 'success' };
  };

  const result2 = await executeWithRetry(successFn);
  assert(result2.ok === true, 'executeWithRetry success');
  assert(result2.attempts === 1, 'executeWithRetry attempts');
  assert(result2.result.value === 'success', 'executeWithRetry result');
  log('✅ Test 2 passed');

  // Test 3: executeWithRetry retry then success
  log('Test 3: executeWithRetry retry then success');
  
  callCount = 0;
  const retryThenSuccessFn = () => {
    callCount++;
    if (callCount < 3) {
      throw { code: 'ECONNRESET', message: 'Connection reset' };
    }
    return { value: 'success after retry' };
  };

  const result3 = await executeWithRetry(retryThenSuccessFn, {
    maxRetries: 5,
    initialDelayMs: 10, // Fast for testing
    backoffFactor: 1,
    jitterMs: 0
  });
  
  assert(result3.ok === true, 'executeWithRetry retry success');
  assert(result3.attempts === 3, 'executeWithRetry retry attempts');
  assert(result3.result.value === 'success after retry', 'executeWithRetry retry result');
  log('✅ Test 3 passed');

  // Test 4: executeWithRetry max retries exceeded
  log('Test 4: executeWithRetry max retries exceeded');
  
  callCount = 0;
  const alwaysFailFn = () => {
    callCount++;
    throw { code: 'ECONNRESET', message: 'Connection reset' };
  };

  const result4 = await executeWithRetry(alwaysFailFn, {
    maxRetries: 2,
    initialDelayMs: 10,
    backoffFactor: 1,
    jitterMs: 0
  });
  
  assert(result4.ok === false, 'executeWithRetry max retries fail');
  assert(result4.attempts === 3, 'executeWithRetry max retries attempts'); // 1 initial + 2 retries
  assert(result4.error.code === 'ECONNRESET', 'executeWithRetry max retries error');
  log('✅ Test 4 passed');

  // Test 5: executeWithRetry non-retryable error
  log('Test 5: executeWithRetry non-retryable error');
  
  callCount = 0;
  const nonRetryableFn = () => {
    callCount++;
    throw { code: 'EINVAL', message: 'Invalid argument' };
  };

  const result5 = await executeWithRetry(nonRetryableFn, {
    maxRetries: 5,
    initialDelayMs: 10
  });
  
  assert(result5.ok === false, 'executeWithRetry non-retryable fail');
  assert(result5.attempts === 1, 'executeWithRetry non-retryable no retries');
  assert(result5.retryable === false, 'executeWithRetry non-retryable flag');
  log('✅ Test 5 passed');

  // Test 6: shouldRetry logic
  log('Test 6: shouldRetry logic');
  
  const task1 = { retry_count: 0, max_retries: 3 };
  const task2 = { retry_count: 3, max_retries: 3 };
  const task3 = { retry_count: 2, max_retries: 3 };
  
  assert(shouldRetry(task1) === true, 'shouldRetry task1');
  assert(shouldRetry(task2) === false, 'shouldRetry task2');
  assert(shouldRetry(task3) === true, 'shouldRetry task3');
  log('✅ Test 6 passed');

  // Test 7: getNextRetryAt calculation
  log('Test 7: getNextRetryAt calculation');
  
  const now = Date.now();
  const retryAt0 = getNextRetryAt(0, { initialDelayMs: 1000, backoffFactor: 2, jitterMs: 0 });
  const retryAt1 = getNextRetryAt(1, { initialDelayMs: 1000, backoffFactor: 2, jitterMs: 0 });
  
  const time0 = new Date(retryAt0).getTime();
  const time1 = new Date(retryAt1).getTime();
  
  // Should be approximately 1s and 2s from now
  assert(Math.abs(time0 - now - 1000) < 100, 'getNextRetryAt attempt 0');
  assert(Math.abs(time1 - now - 2000) < 100, 'getNextRetryAt attempt 1');
  log('✅ Test 7 passed');

  log('--- All Retry Policy Tests PASSED ✅ ---');

  db.close();
}

run().catch((e) => {
  console.error('TEST FAIL:', e.message);
  process.exit(1);
});
