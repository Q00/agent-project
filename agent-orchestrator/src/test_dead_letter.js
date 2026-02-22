// Phase 2-4: dead-letter handler tests
import { openDatabase } from './db.js';
import { addDeadLetter, closeDeadLetter, getOpenDeadLetters, recoverDeadLetter, getDeadLetterByTask } from './dead_letter_handler.js';

const { db } = openDatabase();

function assert(cond, name) {
  if (!cond) throw new Error(`FAILED: ${name}`);
}

function existsTable(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function ensureDeadLetterSchema() {
  if (existsTable('dead_letters')) return;
  db.prepare(`CREATE TABLE dead_letters (
    dead_letter_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status TEXT NOT NULL DEFAULT 'open',
    resolved_at TEXT,
    UNIQUE(task_id)
  )`).run();
}

function resetDb() {
  const tables = ['dead_letters', 'task_queue', 'session_state'];
  for (const t of tables) {
    if (existsTable(t)) db.prepare(`DELETE FROM ${t}`).run();
  }
}

ensureDeadLetterSchema();
resetDb();

assert(existsTable('dead_letters'), 'dead_letters table exists');
assert(existsTable('task_queue'), 'task_queue table exists');

const now = new Date().toISOString();

db.prepare("INSERT INTO session_state(session_id, namespace, status, phase, heartbeat_at, updated_at) VALUES('s1', 'default', 'waiting', 'idle', ?, ?)").run(now, now);
db.prepare("INSERT INTO task_queue(task_id, session_id, task_type, status) VALUES('t1','s1','typeA','failed')").run();

const inserted = addDeadLetter({
  db,
  taskId: 't1',
  sessionId: 's1',
  reason: 'retry_limit_reached',
  payload: { reason: 'unit-test', code: 500 },
  errorCode: 'E500',
});
assert(inserted, 'dead letter inserted');

const openRows = getOpenDeadLetters({ db, limit: 10 });
assert(openRows.length === 1, 'open dead letters count');

const current = getDeadLetterByTask({ db, taskId: 't1' });
assert(current && current.status === 'open', 'dead letter open state');

const closeOk = closeDeadLetter({ db, taskId: 't1' });
assert(closeOk, 'close dead letter');

const task = db.prepare("SELECT status, retry_count FROM task_queue WHERE task_id='t1'").get();
assert(task.status === 'failed', 'task remains failed before recovery');

const recover = recoverDeadLetter({ db, taskId: 't1' });
assert(recover.recovered === false, 'already closed dead-letter should not recover');

// reopen by inserting another dead-letter target for recovery path
addDeadLetter({
  db,
  taskId: 't1',
  sessionId: 's1',
  reason: 'retest',
  payload: { reason: 'unit-test-2' },
  errorCode: 'E501',
});

const recovery = recoverDeadLetter({ db, taskId: 't1', resetRetryCount: true });
assert(recovery.recovered === false, 'already closed dead-letter should not recover when closed flag set');

// use a fresh task to validate recovery
const t2 = "t2";
db.prepare("INSERT INTO task_queue(task_id, session_id, task_type, status) VALUES(?,?,?,?)").run(t2, 's1', 'typeA', 'failed');
addDeadLetter({
  db,
  taskId: t2,
  sessionId: 's1',
  reason: 'retest',
  payload: { reason: 'unit-test-2' },
  errorCode: 'E501',
});

const recovery2 = recoverDeadLetter({ db, taskId: t2, resetRetryCount: true });
assert(recovery2.recovered === true, 'recovered dead letter');
assert(recovery2.retryCount === 0, 'retry count reset on recovery');

const after = db.prepare("SELECT status FROM dead_letters WHERE task_id='t2' ORDER BY dead_letter_id DESC LIMIT 1").get();
assert(after.status === 'resolved', 'recovered dead-letter resolved');

const taskAfter = db.prepare("SELECT status, retry_count FROM task_queue WHERE task_id='t2'").get();
assert(taskAfter.status === 'pending', 'task back to pending');

console.log('All Phase 2-4 dead-letter tests passed ✅');

db.close();
