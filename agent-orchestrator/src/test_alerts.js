// Phase 2-4: alert rules tests
import { evaluateThresholds, resolveThresholds, parseEnvThresholds, DEFAULT_ALERT_THRESHOLDS } from './alert_rules.js';

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

// Threshold parsing
assert(resolveThresholds({ retryAttempts: 2 }).retryAttempts === 2, 'resolveThresholds override');
assert(Object.keys(DEFAULT_ALERT_THRESHOLDS).length === 8, 'defaults count');

const metrics = {
  retryAttempts: 12,
  retryLimitReached: 5,
  lockExpired: 10,
  duplicateSuppressed: 0,
  staleRecoveryFailed: 2,
  staleRecovered: 1,
  deadLettersOpen: 9,
  lockConflictEvents: 10,
  orphanedLocks: 4,
};

const { alerts, staleFailureRate } = evaluateThresholds(metrics, {
  retryAttempts: 10,
  retryLimitReached: 1,
  lockExpired: 3,
  duplicateSuppressed: 3,
  staleRecoveryFailureRate: 0.2,
  deadLettersOpen: 2,
  lockConflictEvents: 2,
  orphanedLocks: 1,
});

assert(staleFailureRate > 0, 'staleRecoveryFailureRate computed');
assert(alerts.some((x) => x.key === 'retryAttemptsSpike'), 'retryAttemptsSpike alert');
assert(alerts.some((x) => x.key === 'retryLimitReached'), 'retryLimitReached alert');
assert(alerts.some((x) => x.key === 'lockExpired'), 'lockExpired alert');
assert(alerts.some((x) => x.key === 'deadLettersOpen'), 'deadLettersOpen alert');
assert(alerts.some((x) => x.key === 'lockConflictEvents'), 'lockConflictEvents alert');
assert(alerts.some((x) => x.key === 'orphanedLocks'), 'orphanedLocks alert');
assert(alerts.some((x) => x.key === 'staleRecoveryFailureRate'), 'staleRecoveryFailureRate alert');

const env = {
  METRICS_THRESHOLD_RETRY_ATTEMPTS: '7',
  METRICS_THRESHOLD_RETRY_LIMIT_REACHED: '99',
  METRICS_THRESHOLD_STALE_FAILURE_RATE: '0.5',
};
const parsed = parseEnvThresholds(env);
assert(parsed.retryAttempts === 7, 'parseEnvRetries');
assert(parsed.retryLimitReached === 99, 'parseEnvRetryLimit');
assert(parsed.staleRecoveryFailureRate === 0.5, 'parseEnvFailureRate');

const envAlias = {
  METRICS_THRESHOLD_STALE_RECOVERY_FAILURE_RATE: '0.25',
};
const parsedAlias = parseEnvThresholds(envAlias);
assert(parsedAlias.staleRecoveryFailureRate === 0.25, 'parseEnvFailureRateAlias');

console.log('All Phase 2-4 alert rule tests passed ✅');
