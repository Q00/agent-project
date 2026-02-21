// Phase 2-3: Metrics Reporter
import { openDatabase } from './db.js';
import { buildMetrics } from './metrics.js';

const windowMinutes = Number(process.argv[2] || 60);

const { db } = openDatabase();
try {
  const m = buildMetrics({ db, sinceMinutes: windowMinutes });
  console.log(JSON.stringify(m, null, 2));
} finally {
  db.close();
}
