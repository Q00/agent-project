// Phase 3: multi-process concurrency stress test runner
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDatabase } from '../db.js';

const args = new Map(
  process.argv.slice(2).map((kv) => {
    const [k, v] = kv.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const sessionId = String(args.get('session') || 'phase3-sess');
const workers = Number(args.get('workers') || 8);
const iterations = Number(args.get('iterations') || 80);
const tasks = Number(args.get('tasks') || 120);
const failRate = Number(args.get('failRate') || 0.12);

const workerScript = fileURLToPath(new URL('./bench_concurrency_worker.mjs', import.meta.url));

function seed(db) {
  db.prepare('DELETE FROM event_log').run();
  db.prepare('DELETE FROM task_queue').run();
  db.prepare('DELETE FROM distributed_lock').run();
  db.prepare('DELETE FROM session_state').run();
  db.prepare(`INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at)
              VALUES(?, ?, 'idle', 'idle', ?, ?)`).run(sessionId, 'phase3', new Date().toISOString(), new Date().toISOString());

  const insert = db.prepare('INSERT INTO task_queue(task_id, session_id, task_type, payload) VALUES(?, ?, ?, ?)');
  const taskRows = [];
  for (let i = 0; i < tasks; i++) {
    const taskId = `phase3-${sessionId}-${i}`;
    insert.run(taskId, sessionId, 'typeA', JSON.stringify({ i }));
    taskRows.push(taskId);
  }
  return taskRows.length;
}

function runWorker(id) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [workerScript, sessionId, String(id), String(iterations), String(failRate)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let err = '';
    p.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    p.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${id} exit ${code}: ${err || output}`));
        return;
      }
      try {
        resolve(JSON.parse(output.trim().split('\n').pop()));
      } catch (_e) {
        reject(new Error(`worker ${id} invalid output: ${output}`));
      }
    });
  });
}

async function run() {
  const { db } = openDatabase();
  const totalTasks = seed(db);
  db.close();

  const start = Date.now();
  const results = await Promise.all(Array.from({ length: workers }, (_, i) => runWorker(i + 1)));
  const elapsedMs = Date.now() - start;

  const agg = results.reduce(
    (acc, r) => {
      acc.claims += r.claims || 0;
      acc.busy += r.busy || 0;
      acc.noTask += r.noTask || 0;
      acc.released += r.released || 0;
      acc.failedReleases += r.failedReleases || 0;
      acc.heartbeatOk += r.heartbeatOk || 0;
      acc.heartbeatMiss += r.heartbeatMiss || 0;
      acc.staleInjected += r.staleInjected || 0;
      return acc;
    },
    { claims: 0, busy: 0, noTask: 0, released: 0, failedReleases: 0, heartbeatOk: 0, heartbeatMiss: 0, staleInjected: 0 }
  );

  console.log(JSON.stringify({
    scenario: 'phase3-concurrency',
    sessionId,
    workers,
    iterations,
    failRate,
    totalTasks,
    elapsedMs,
    ...agg,
    successRate: totalTasks > 0 ? agg.claims / totalTasks : 0,
    conflictRatio: (agg.busy + agg.noTask) > 0 ? agg.busy / (agg.busy + agg.noTask) : 0,
  }));
}

run().catch((err) => {
  console.error('phase3 concurrency failed:', err);
  process.exit(1);
});
