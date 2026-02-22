// Phase 3: concurrent worker for load testing
import { openDatabase } from '../db.js';
import { claimTask, heartbeat, releaseTask } from '../orchestrator.js';

const [, , sessionId, workerId, iterations, failRateRaw] = process.argv;
const iter = Number(iterations || 80);
const failRate = Number(failRateRaw || 0.1);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const { db } = openDatabase();

  const stats = {
    workerId,
    claims: 0,
    busy: 0,
    noTask: 0,
    released: 0,
    failedReleases: 0,
    heartbeatOk: 0,
    heartbeatMiss: 0,
    staleInjected: 0,
    timedOut: 0,
  };

  for (let i = 0; i < iter; i++) {
    const claim = claimTask({ db, sessionId, agent: `worker-${workerId}` });
    if (!claim.ok) {
      if (claim.reason === 'busy') stats.busy += 1;
      if (claim.reason === 'no_task') stats.noTask += 1;
      await sleep(25 + Math.random() * 40);
      continue;
    }

    stats.claims += 1;

    const hb = heartbeat({ db, sessionId, lockToken: claim.lockToken, agent: `worker-${workerId}` });
    if (hb) stats.heartbeatOk += 1;
    else stats.heartbeatMiss += 1;

    const shouldFail = Math.random() < failRate;

    // occasionally create a stale lock window to exercise stale/recovery path
    if (Math.random() < 0.02) {
      const stale = new Date(Date.now() - 120000).toISOString();
      db.prepare('UPDATE distributed_lock SET expires_at=? WHERE lock_key=? AND owner_token=?')
        .run(stale, `session:${sessionId}:lock`, claim.lockToken);
      stats.staleInjected += 1;
    }

    const timeoutAt = Date.now() + 600;
    const res = releaseTask({
      db,
      sessionId,
      taskId: claim.taskId,
      lockToken: claim.lockToken,
      agent: `worker-${workerId}`,
      result: shouldFail
        ? { ok: false, errorCode: 'E_PHASE3_SIM', errorMsg: 'phase3 synthetic failure' }
        : { ok: true },
    });

    if (!res || Date.now() > timeoutAt) {
      stats.timedOut += 1;
      stats.failedReleases += 1;
    } else if (res.ok) {
      stats.released += 1;
    } else {
      stats.failedReleases += 1;
    }

    await sleep(10 + Math.random() * 20);
  }

  db.close();
  process.stdout.write(JSON.stringify(stats) + '\n');
}

run().catch((err) => {
  console.error(JSON.stringify({ workerId, error: String(err) }));
  process.exit(1);
});
