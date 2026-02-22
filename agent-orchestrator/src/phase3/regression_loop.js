// Phase 3: long-run regression loop
import { spawn } from 'node:child_process';
import path from 'node:path';
import { openDatabase } from '../db.js';
import { buildMetrics } from '../metrics.js';

const BENCH_PATH = path.join(process.cwd(), 'src', 'phase3', 'bench_concurrency.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getArg(name, fallback) {
  const token = process.argv.find((v) => v.startsWith(`--${name}=`));
  return token ? token.split('=')[1] : fallback;
}

async function runBenchmark(round, opts) {
  const { workers, sessionId, tasks, iterations, failRate } = opts;
  const args = [
    BENCH_PATH,
    `--workers=${workers}`,
    `--session=${sessionId}`,
    `--tasks=${tasks}`,
    `--iterations=${iterations}`,
    `--failRate=${failRate}`,
  ];

  const out = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    p.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`benchmark exit ${code}: ${stderr || stdout}`));
      resolve({ stdout, stderr });
    });
  });

  const { db } = openDatabase();
  const m = buildMetrics({ db, sinceMinutes: 3600 });
  db.close();

  const lastLine = out.stdout.trim().split('\n').filter(Boolean).pop();
  const summary = (() => {
    try {
      return JSON.parse(lastLine);
    } catch (_e) {
      return { raw: lastLine };
    }
  })();

  return {
    round,
    summary,
    metrics: {
      staleRecoveryFailureRate: m.staleRecoveryFailureRate,
      staleRecovered: m.staleRecovered,
      staleRecoveryFailed: m.staleRecoveryFailed,
      deadLettersOpen: m.deadLettersOpen,
      lockConflictEvents: m.lockConflictEvents,
      orphanedLocks: m.orphanedLocks,
      retryLimitReached: m.retryLimitReached,
    },
  };
}

async function run() {
  const rounds = Number(getArg('rounds', 5));
  const workers = Number(getArg('workers', 6));
  const tasks = Number(getArg('tasks', 120));
  const iterations = Number(getArg('iterations', 60));
  const failRate = Number(getArg('failRate', 0.18));

  const reports = [];

  for (let r = 1; r <= rounds; r++) {
    const report = await runBenchmark(r, {
      sessionId: `phase3-reg-r${r}`,
      workers,
      tasks,
      iterations,
      failRate,
    });
    reports.push(report);
    console.log(`round ${r} done`);
    await sleep(200);
  }

  console.log('REGRESSION_REPORT=' + JSON.stringify({ rounds, workers, tasks, iterations, failRate, reports }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
