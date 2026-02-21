import { openDatabase } from './db.js';
import { claimTask, heartbeat, releaseTask, LOCK_TTL_MS, HEARTBEAT_MS } from './orchestrator.js';
import { staleRecovery } from './staleRecovery.js';

const { db, dbPath } = openDatabase();
function log(msg) { console.log(msg); }

function seedSession(sessionId) {
  const now = new Date().toISOString();
  db.prepare(`DELETE FROM event_log WHERE session_id=?`).run(sessionId);
  db.prepare(`DELETE FROM task_queue WHERE session_id=?`).run(sessionId);
  db.prepare(`DELETE FROM distributed_lock WHERE lock_key=?`).run(`session:${sessionId}:lock`);
  db.prepare(`DELETE FROM session_state WHERE session_id=?`).run(sessionId);
  db.prepare(`INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at)
              VALUES(?, 'default', 'idle', 'idle', ?, ?)`).run(sessionId, now, now);
  db.prepare(`INSERT INTO task_queue(task_id, session_id, task_type, payload)
              VALUES(?, ?, 'typeA', '{"foo":"bar"}')`).run(`task-${sessionId}`, sessionId);
}

function countEvents(sessionId) {
  return db.prepare('SELECT COUNT(*) AS c FROM event_log WHERE session_id=?').get(sessionId).c;
}

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

// removed sleep helper

async function run() {
  log(`Using db: ${dbPath}`);

  // 1) normal claim -> complete
  seedSession('s1');
  const r1 = claimTask({ db, sessionId: 's1', agent: 'agent-a' });
  assert(r1.ok, 'normal claim');
  const e1 = countEvents('s1');
  const r1h = heartbeat({ db, sessionId: 's1', lockToken: r1.lockToken, agent: 'agent-a' });
  assert(r1h, 'heartbeat updates');
  const r1r = releaseTask({ db, sessionId: 's1', taskId: r1.taskId, lockToken: r1.lockToken, agent: 'agent-a', result: { ok: true } });
  assert(r1r.ok, 'release success');
  assert(r1r.ok, 'release ok');
  const e1b = countEvents('s1');
  log(`Test1 session_state status=${db.prepare('SELECT status FROM session_state WHERE session_id=?').get('s1').status}`);

  // 2) concurrent claim one succeeds
  seedSession('s2');
  const c1 = claimTask({ db, sessionId: 's2', agent: 'a1' });
  const c2 = claimTask({ db, sessionId: 's2', agent: 'a2' });
  assert(c1.ok !== c2.ok, 'only one claim succeeds');

  // 3) lock expiry -> takeover
  seedSession('s3');
  const c3a = claimTask({ db, sessionId: 's3', agent: 'a1' });
  assert(c3a.ok, 'initial claim');
  // force expiry
  const expired = new Date(Date.now() - LOCK_TTL_MS - 1000).toISOString();
  db.prepare('UPDATE distributed_lock SET expires_at=? WHERE lock_key=?').run(expired, 'session:s3:lock');
  const c3b = claimTask({ db, sessionId: 's3', agent: 'a2' });
  assert(c3b.ok, 'takeover claim after expiry');

  // 4) duplicate execution skip
  seedSession('s4');
  const c4a = claimTask({ db, sessionId: 's4', agent: 'a1' });
  assert(c4a.ok, 'claim once');
  const duplicateEventBefore = countEvents('s4');
  const c4b = claimTask({ db, sessionId: 's4', agent: 'a2' });
  assert(!c4b.ok, 'duplicate claim skipped');
  const duplicateEventAfter = countEvents('s4');
  assert(duplicateEventAfter === duplicateEventBefore, 'no new event on duplicate');

  // stale path check
  seedSession('s5');
  const c5a = claimTask({ db, sessionId: 's5', agent: 'a1' });
  assert(c5a.ok, 'claim for stale case');
  const staleAt = new Date(Date.now() - HEARTBEAT_MS * 3).toISOString();
  db.prepare("UPDATE session_state SET heartbeat_at=?, status='running', lock_expires_at=? WHERE session_id=?").run(
    staleAt,
    staleAt,
    's5'
  );
  const stale = staleRecovery({ db, agent: 'watchdog' });
  assert(stale.recovered === 1, 'stale recovered');

  // final integrity checks
  const sessions = ['s1', 's2', 's3', 's4', 's5'];
  for (const s of sessions) {
    const latestSeq = db.prepare('SELECT COALESCE(MAX(event_seq),0) AS s FROM event_log WHERE session_id=?').get(s).s;
    const cp = db.prepare('SELECT checkpoint_seq FROM session_state WHERE session_id=?').get(s)?.checkpoint_seq;
    assert(cp === null || cp === undefined || cp <= latestSeq, `checkpoint integrity ${s}`);
  }

  log('--- Test report ---');
  log(`normal: ${r1.ok}, events+${e1b - e1}`);
  log(`claim contention: ${c1.ok} vs ${c2.ok}`);
  log(`takeover: ${c3b.ok}`);
  log(`duplicate skip: ${c4b.reason}`);
  log(`stale recovery: ${stale.recovered}`);
  log('ALL TESTS PASSED ✅');

  db.close();
}

run().catch((e) => {
  console.error('TEST FAIL:', e.message);
  process.exit(1);
});
