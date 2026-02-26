import { randomUUID } from 'node:crypto';
import { nowIso, withTransaction } from './db.js';

/**
 * Enqueue a new task
 */
export function enqueueTask({ 
  db, 
  taskId, 
  sessionId, 
  kind, 
  priority = 5, 
  payload = {}, 
  dedupeKey = null,
  maxRetries = 3 
}) {
  const now = nowIso();
  const actualTaskId = taskId || `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  
  try {
    const result = withTransaction(db, () => {
      // Check dedupe_key if provided
      if (dedupeKey) {
        const existing = db.prepare(`
          SELECT task_id FROM task_queue 
          WHERE session_id = ? AND dedupe_key = ? AND status IN ('queued', 'claimed', 'running')
        `).get(sessionId, dedupeKey);
        
        if (existing) {
          return { ok: false, reason: 'duplicate', taskId: existing.task_id };
        }
      }
      
      // Insert task
      db.prepare(`
        INSERT INTO task_queue (
          task_id, session_id, task_type, priority, payload, status, 
          dedupe_key, retry_count, max_retries, created_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?)
      `).run(
        actualTaskId, sessionId, kind, priority, JSON.stringify(payload),
        dedupeKey, maxRetries, now
      );
      
      // Log event
      const eventSeq = db.prepare(`
        SELECT COALESCE(MAX(event_seq), 0) + 1 AS seq 
        FROM event_log 
        WHERE session_id = ?
      `).get(sessionId).seq;
      
      db.prepare(`
        INSERT INTO event_log (
          session_id, event_seq, event_type, actor_agent, 
          idempotency_key, payload, status
        ) VALUES (?, ?, 'task_enqueued', 'orchestrator', ?, ?, 'ok')
      `).run(
        sessionId, eventSeq, `enqueue-${actualTaskId}`, JSON.stringify({
          taskId: actualTaskId,
          kind,
          priority
        })
      );
      
      return { ok: true, taskId: actualTaskId };
    });
    
    return result;
    
  } catch (error) {
    return { 
      ok: false, 
      reason: 'error', 
      error: error.message 
    };
  }
}

/**
 * Claim next task (priority-based)
 */
export function claimNextTask({ db, sessionId, ownerAgent }) {
  const now = nowIso();
  
  try {
    const result = withTransaction(db, () => {
      // Get highest priority queued task
      const task = db.prepare(`
        SELECT task_id, task_type, priority, payload, retry_count, max_retries
        FROM task_queue
        WHERE session_id = ? AND status = 'queued'
        ORDER BY priority ASC, created_at ASC
        LIMIT 1
      `).get(sessionId);
      
      if (!task) {
        return { ok: false, reason: 'no_tasks' };
      }
      
      // Claim task
      db.prepare(`
        UPDATE task_queue
        SET status = 'claimed', owner_agent = ?, started_at = ?
        WHERE task_id = ? AND status = 'queued'
      `).run(ownerAgent, now, task.task_id);
      
      // Log event
      const eventSeq = db.prepare(`
        SELECT COALESCE(MAX(event_seq), 0) + 1 AS seq 
        FROM event_log 
        WHERE session_id = ?
      `).get(sessionId).seq;
      
      db.prepare(`
        INSERT INTO event_log (
          session_id, event_seq, event_type, actor_agent,
          idempotency_key, payload, status
        ) VALUES (?, ?, 'task_claimed', ?, ?, ?, 'ok')
      `).run(
        sessionId, eventSeq, ownerAgent, `claim-${task.task_id}-${eventSeq}`, JSON.stringify({
          taskId: task.task_id,
          kind: task.task_type,
          priority: task.priority
        })
      );
      
      return { 
        ok: true, 
        task: {
          taskId: task.task_id,
          kind: task.task_type,
          priority: task.priority,
          payload: JSON.parse(task.payload || '{}'),
          retryCount: task.retry_count,
          maxRetries: task.max_retries
        }
      };
    });
    
    return result;
    
  } catch (error) {
    return { 
      ok: false, 
      reason: 'error', 
      error: error.message 
    };
  }
}

/**
 * Start claimed task
 */
export function startTask({ db, taskId, ownerAgent }) {
  const now = nowIso();
  
  try {
    const result = withTransaction(db, () => {
      const task = db.prepare(`
        SELECT session_id, status FROM task_queue WHERE task_id = ?
      `).get(taskId);
      
      if (!task) {
        return { ok: false, reason: 'not_found' };
      }
      
      if (task.status !== 'claimed') {
        return { ok: false, reason: 'invalid_status', currentStatus: task.status };
      }
      
      // Update to running
      db.prepare(`
        UPDATE task_queue
        SET status = 'running', heartbeat_at = ?
        WHERE task_id = ? AND status = 'claimed'
      `).run(now, taskId);
      
      // Log event
      const eventSeq = db.prepare(`
        SELECT COALESCE(MAX(event_seq), 0) + 1 AS seq 
        FROM event_log 
        WHERE session_id = ?
      `).get(task.session_id).seq;
      
      db.prepare(`
        INSERT INTO event_log (
          session_id, event_seq, event_type, actor_agent,
          idempotency_key, payload, status
        ) VALUES (?, ?, 'task_started', ?, ?, ?, 'ok')
      `).run(
        task.session_id, eventSeq, ownerAgent, `start-${taskId}-${eventSeq}`, JSON.stringify({
          taskId
        })
      );
      
      return { ok: true };
    });
    
    return result;
    
  } catch (error) {
    return { 
      ok: false, 
      reason: 'error', 
      error: error.message 
    };
  }
}

/**
 * Complete task
 */
export function completeTask({ 
  db, 
  taskId, 
  status: finalStatus = 'done', 
  errorCode = null, 
  errorMsg = null 
}) {
  const now = nowIso();
  
  if (!['done', 'failed', 'dead'].includes(finalStatus)) {
    return { ok: false, reason: 'invalid_status' };
  }
  
  try {
    const result = withTransaction(db, () => {
      const task = db.prepare(`
        SELECT session_id, status, retry_count, max_retries 
        FROM task_queue 
        WHERE task_id = ?
      `).get(taskId);
      
      if (!task) {
        return { ok: false, reason: 'not_found' };
      }
      
      if (task.status !== 'running') {
        return { ok: false, reason: 'invalid_status', currentStatus: task.status };
      }
      
      // Determine final status
      let actualStatus = finalStatus;
      let shouldRetry = false;
      
      if (finalStatus === 'failed') {
        // Check if we can retry
        if (task.retry_count < task.max_retries) {
          // Mark for retry
          actualStatus = 'queued';
          shouldRetry = true;
        } else {
          // Max retries exceeded → dead
          actualStatus = 'dead';
        }
      }
      
      // Update task
      if (shouldRetry) {
        const nextRetryCount = task.retry_count + 1;
        const nextRetryAt = new Date(Date.now() + Math.pow(2, nextRetryCount) * 1000).toISOString();
        
        db.prepare(`
          UPDATE task_queue
          SET status = 'queued', 
              owner_agent = NULL,
              retry_count = ?, 
              next_retry_at = ?, 
              last_error = ?, 
              error_code = ?, 
              error_msg = ?,
              heartbeat_at = NULL
          WHERE task_id = ?
        `).run(nextRetryCount, nextRetryAt, errorMsg, errorCode, errorMsg, taskId);
      } else {
        db.prepare(`
          UPDATE task_queue
          SET status = ?, finished_at = ?, error_code = ?, error_msg = ?
          WHERE task_id = ?
        `).run(actualStatus, now, errorCode, errorMsg, taskId);
      }
      
      // Log event
      const eventSeq = db.prepare(`
        SELECT COALESCE(MAX(event_seq), 0) + 1 AS seq 
        FROM event_log 
        WHERE session_id = ?
      `).get(task.session_id).seq;
      
      const eventType = actualStatus === 'done' ? 'task_completed' : 
                        actualStatus === 'dead' ? 'task_dead' : 
                        shouldRetry ? 'task_retry_scheduled' : 'task_failed';
      
      db.prepare(`
        INSERT INTO event_log (
          session_id, event_seq, event_type, actor_agent,
          idempotency_key, payload, status, error_code
        ) VALUES (?, ?, ?, 'orchestrator', ?, ?, ?, ?)
      `).run(
        task.session_id, eventSeq, eventType, `complete-${taskId}-${eventSeq}`, JSON.stringify({
          taskId,
          finalStatus: actualStatus,
          errorCode,
          errorMsg,
          retryCount: task.retry_count,
          willRetry: shouldRetry
        }), actualStatus === 'done' ? 'ok' : 'error', errorCode
      );
      
      return { 
        ok: true, 
        finalStatus: actualStatus,
        willRetry: shouldRetry,
        retryCount: task.retry_count
      };
    });
    
    return result;
    
  } catch (error) {
    return { 
      ok: false, 
      reason: 'error', 
      error: error.message 
    };
  }
}
