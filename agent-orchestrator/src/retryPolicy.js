// Retry Policy for Agent Orchestrator
// Phase 2-2: Resilience layer

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_JITTER_MS = 100;

// Retryable error codes (transient failures)
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'TRANSIENT_ERROR'
]);

// Retryable error patterns
const RETRYABLE_PATTERNS = [
  /timeout/i,
  /connection.*reset/i,
  /temporarily unavailable/i,
  /resource.*busy/i,
  /lock.*conflict/i
];

function isRetryable(error) {
  if (!error) return false;
  
  // Check error code
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }
  
  // Check error message patterns
  const message = error.message || error.toString();
  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }
  
  return false;
}

function calculateDelay(attempt, opts = {}) {
  const baseDelay = opts.initialDelayMs || DEFAULT_INITIAL_DELAY_MS;
  const factor = opts.backoffFactor || DEFAULT_BACKOFF_FACTOR;
  const jitter = opts.jitterMs || DEFAULT_JITTER_MS;
  
  // Exponential backoff: baseDelay * (factor ^ attempt)
  const delay = baseDelay * Math.pow(factor, attempt);
  
  // Add jitter to avoid thundering herd
  const jitterAmount = Math.random() * jitter;
  
  return Math.floor(delay + jitterAmount);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeWithRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const errors = [];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { ok: true, result, attempts: attempt + 1 };
    } catch (error) {
      errors.push(error);
      
      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(error)) {
        return {
          ok: false,
          error,
          errors,
          attempts: attempt + 1,
          retryable: isRetryable(error)
        };
      }
      
      // Wait before retrying
      const delay = calculateDelay(attempt, opts);
      await sleep(delay);
    }
  }
  
  return {
    ok: false,
    error: errors[errors.length - 1],
    errors,
    attempts: maxRetries + 1,
    retryable: false
  };
}

// Synchronous version for better-sqlite3
function executeWithRetrySync(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const errors = [];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = fn();
      return { ok: true, result, attempts: attempt + 1 };
    } catch (error) {
      errors.push(error);
      
      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(error)) {
        return {
          ok: false,
          error,
          errors,
          attempts: attempt + 1,
          retryable: isRetryable(error)
        };
      }
      
      // Synchronous sleep not possible, just retry immediately
      // In production, consider using async version
    }
  }
  
  return {
    ok: false,
    error: errors[errors.length - 1],
    errors,
    attempts: maxRetries + 1,
    retryable: false
  };
}

function shouldRetry(task) {
  if (!task) return false;
  
  const retryCount = task.retry_count || 0;
  const maxRetries = task.max_retries || DEFAULT_MAX_RETRIES;
  
  return retryCount < maxRetries;
}

function getNextRetryAt(attempt, opts = {}) {
  const delay = calculateDelay(attempt, opts);
  return new Date(Date.now() + delay).toISOString();
}

export {
  isRetryable,
  calculateDelay,
  executeWithRetry,
  executeWithRetrySync,
  shouldRetry,
  getNextRetryAt,
  RETRYABLE_ERROR_CODES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
  DEFAULT_JITTER_MS
};
