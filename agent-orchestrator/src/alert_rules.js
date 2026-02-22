// Phase 2-4: centralized operational alert rules

export const DEFAULT_ALERT_THRESHOLDS = {
  retryAttempts: 10,
  retryLimitReached: 1,
  lockExpired: 3,
  duplicateSuppressed: 3,
  staleRecoveryFailureRate: 0.2,
  deadLettersOpen: 1,
  lockConflictEvents: 3,
  orphanedLocks: 1,
};

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveThresholds(overrides = {}) {
  return {
    ...DEFAULT_ALERT_THRESHOLDS,
    ...overrides,
  };
}

export function parseEnvThresholds(env = process.env) {
  return resolveThresholds({
    retryAttempts: toNumber(env.METRICS_THRESHOLD_RETRY_ATTEMPTS, DEFAULT_ALERT_THRESHOLDS.retryAttempts),
    retryLimitReached: toNumber(env.METRICS_THRESHOLD_RETRY_LIMIT_REACHED, DEFAULT_ALERT_THRESHOLDS.retryLimitReached),
    lockExpired: toNumber(env.METRICS_THRESHOLD_LOCK_EXPIRED, DEFAULT_ALERT_THRESHOLDS.lockExpired),
    duplicateSuppressed: toNumber(env.METRICS_THRESHOLD_DUPLICATE_SUPPRESSED, DEFAULT_ALERT_THRESHOLDS.duplicateSuppressed),
    staleRecoveryFailureRate: toNumber(env.METRICS_THRESHOLD_STALE_FAILURE_RATE, DEFAULT_ALERT_THRESHOLDS.staleRecoveryFailureRate),
    deadLettersOpen: toNumber(env.METRICS_THRESHOLD_DEAD_LETTERS_OPEN, DEFAULT_ALERT_THRESHOLDS.deadLettersOpen),
    lockConflictEvents: toNumber(env.METRICS_THRESHOLD_LOCK_CONFLICT_EVENTS, DEFAULT_ALERT_THRESHOLDS.lockConflictEvents),
    orphanedLocks: toNumber(env.METRICS_THRESHOLD_ORPHANED_LOCKS, DEFAULT_ALERT_THRESHOLDS.orphanedLocks),
  });
}

function addAlert(alerts, key, level, value, threshold, message) {
  alerts.push({ key, level, value, threshold, message });
}

export function evaluateThresholds(metrics = {}, overrides = {}) {
  const cfg = resolveThresholds(overrides);

  const staleRecovered = Number(metrics.staleRecovered || 0);
  const staleFailures = Number(metrics.staleRecoveryFailed || 0);
  const staleTotal = staleRecovered + staleFailures;
  const staleFailureRate = staleTotal > 0 ? staleFailures / staleTotal : 0;

  const alerts = [];

  if ((metrics.retryAttempts || 0) > cfg.retryAttempts) {
    addAlert(alerts, 'retryAttemptsSpike', 'warn', metrics.retryAttempts, cfg.retryAttempts,
      `retryAttempts=${metrics.retryAttempts} exceeds threshold ${cfg.retryAttempts}`);
  }

  if ((metrics.retryLimitReached || 0) > cfg.retryLimitReached) {
    addAlert(alerts, 'retryLimitReached', 'warn', metrics.retryLimitReached, cfg.retryLimitReached,
      `retryLimitReached=${metrics.retryLimitReached} exceeds threshold ${cfg.retryLimitReached}`);
  }

  if ((metrics.lockExpired || 0) > cfg.lockExpired) {
    addAlert(alerts, 'lockExpired', 'warn', metrics.lockExpired, cfg.lockExpired,
      `lockExpired=${metrics.lockExpired} exceeds threshold ${cfg.lockExpired}`);
  }

  if ((metrics.duplicateSuppressed || 0) > cfg.duplicateSuppressed) {
    addAlert(alerts, 'duplicateSuppressed', 'warn', metrics.duplicateSuppressed, cfg.duplicateSuppressed,
      `duplicateSuppressed=${metrics.duplicateSuppressed} exceeds threshold ${cfg.duplicateSuppressed}`);
  }

  if (staleFailureRate > cfg.staleRecoveryFailureRate) {
    addAlert(alerts, 'staleRecoveryFailureRate', 'warn', staleFailureRate, cfg.staleRecoveryFailureRate,
      `staleRecoveryFailureRate=${staleFailureRate.toFixed(4)} exceeds threshold ${cfg.staleRecoveryFailureRate}`);
  }

  if ((metrics.deadLettersOpen || 0) > cfg.deadLettersOpen) {
    addAlert(alerts, 'deadLettersOpen', 'warn', metrics.deadLettersOpen, cfg.deadLettersOpen,
      `deadLettersOpen=${metrics.deadLettersOpen} exceeds threshold ${cfg.deadLettersOpen}`);
  }

  if ((metrics.lockConflictEvents || 0) > cfg.lockConflictEvents) {
    addAlert(alerts, 'lockConflictEvents', 'warn', metrics.lockConflictEvents, cfg.lockConflictEvents,
      `lockConflictEvents=${metrics.lockConflictEvents} exceeds threshold ${cfg.lockConflictEvents}`);
  }

  if ((metrics.orphanedLocks || 0) > cfg.orphanedLocks) {
    addAlert(alerts, 'orphanedLocks', 'warn', metrics.orphanedLocks, cfg.orphanedLocks,
      `orphanedLocks=${metrics.orphanedLocks} exceeds threshold ${cfg.orphanedLocks}`);
  }

  return {
    alerts,
    staleFailureRate,
    thresholds: cfg,
  };
}
