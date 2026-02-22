// Phase 2-3/2-4: Metrics Reporter
import { openDatabase } from './db.js';
import { buildMetrics, evaluateThresholds } from './metrics.js';
import { parseEnvThresholds } from './alert_rules.js';

const windowMinutes = Number(process.argv[2] || 60);

const thresholdOverrides = parseEnvThresholds();

const { db } = openDatabase();
try {
  const m = buildMetrics({ db, sinceMinutes: windowMinutes });
  const { alerts, staleFailureRate, thresholds } = evaluateThresholds(m, thresholdOverrides);

  const payload = {
    ...m,
    staleRecoveryFailureRate: staleFailureRate,
    thresholds,
    alerts,
  };

  if (alerts.length) {
    console.log('METRICS_ALERT=1');
  }
  console.log(JSON.stringify(payload, null, 2));
} finally {
  db.close();
}
