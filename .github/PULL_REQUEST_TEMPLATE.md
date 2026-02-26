# Phase A: Task Queue API 구현

## 🎯 개요

q00-diet-religion과 통합 가능한 **Task Queue API**를 구현했습니다. 명칭을 통일하고, 재시도 로직과 dead letter queue를 추가했습니다.

---

## ✨ 주요 변경사항

### 1. Task Queue API

#### enqueueTask
```javascript
enqueueTask({
  db,
  taskId: 'kpi-2026-02-27',
  sessionId: 'trading-session',
  kind: 'kpi.dailyReport',
  priority: 5,
  payload: { date: '2026-02-27' },
  dedupeKey: 'kpi-2026-02-27',
  maxRetries: 3
})
// Returns: { ok: true, taskId: 'kpi-2026-02-27' }
```

#### claimNextTask
```javascript
claimNextTask({
  db,
  sessionId: 'trading-session',
  ownerAgent: 'worker-1'
})
// Returns: { ok: true, task: { taskId, kind, priority, payload, retryCount, maxRetries } }
```

#### startTask
```javascript
startTask({
  db,
  taskId: 'kpi-2026-02-27',
  ownerAgent: 'worker-1'
})
// Returns: { ok: true }
```

#### completeTask
```javascript
completeTask({
  db,
  taskId: 'kpi-2026-02-27',
  status: 'done' | 'failed' | 'dead',
  errorCode: null,
  errorMsg: null
})
// Returns: { ok: true, finalStatus: 'done', willRetry: false }
```

---

### 2. 명칭 정합 (q00-diet-religion 통일)

| 항목 | 이전 | 통일 |
|------|------|------|
| 타입 필드 | `task_type` | ✅ `kind` |
| 상태 필드 | `pending` | ✅ `queued` |
| 상태 전이 | `pending → claimed → running` | ✅ `queued → claimed → running` |

**Task Kind:**
- `trade.decide`
- `kpi.dailyReport`
- `maintenance.reconcile`
- `agent.orchestrate`

---

### 3. 재시도 로직

#### Exponential Backoff
```javascript
// 실패 시 자동으로 queued 상태로 복귀
if (retry_count < max_retries) {
  status = 'queued';
  next_retry_at = Date.now() + Math.pow(2, retry_count + 1) * 1000;
  retry_count++;
}
```

#### Dead Letter Queue
```javascript
// max_retries 초과 시 dead letter로 이동
if (retry_count >= max_retries) {
  status = 'dead';
  error_code = 'MAX_RETRIES_EXCEEDED';
}
```

---

### 4. Event Log 연동

모든 상태 변경을 `event_log`에 기록:

```sql
INSERT INTO event_log (
  session_id, event_seq, event_type, actor_agent,
  idempotency_key, payload, status
) VALUES (?, ?, 'task_enqueued', 'orchestrator', ?, ?, 'ok');
```

**Event Types:**
- `task_enqueued`
- `task_claimed`
- `task_started`
- `task_completed` / `task_failed` / `task_dead`
- `task_retry_scheduled`

---

### 5. 스키마 수정

#### task_queue 테이블
```sql
CREATE TABLE task_queue (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  payload TEXT DEFAULT '{}',
  status TEXT DEFAULT 'queued',  -- 'pending' → 'queued'
  owner_agent TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,  -- 추가
  finished_at TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,  -- 추가
  last_error TEXT,
  next_retry_at TEXT,
  error_code TEXT,
  error_msg TEXT
);
```

---

## 🧪 테스트

### 테스트 시나리오 (5개)

#### 1. enqueue → claim → complete flow ✅
```javascript
enqueueTask() → claimNextTask() → startTask() → completeTask()
```

#### 2. priority ordering ✅
```javascript
// 높은 우선순위 태스크가 먼저 처리됨
enqueueTask({ priority: 10 })
enqueueTask({ priority: 1 })
claimNextTask() // → priority 1
```

#### 3. dedupe_key prevents duplicates ✅
```javascript
// 같은 dedupe_key로 중복 enqueue 방지
enqueueTask({ dedupeKey: 'kpi-2026-02-27' }) // → ok: true
enqueueTask({ dedupeKey: 'kpi-2026-02-27' }) // → ok: false, reason: 'duplicate'
```

#### 4. dead letter on max retries exceeded ✅
```javascript
// max_retries 초과 시 dead letter로 이동
enqueueTask({ maxRetries: 2 })
completeTask({ status: 'failed' }) // → queued (retry)
completeTask({ status: 'failed' }) // → dead (max_retries exceeded)
```

#### 5. no tasks available ✅
```javascript
claimNextTask() // → { ok: false, reason: 'no_tasks' }
```

### 실행 결과
```bash
npm test
# ✅ All Task Queue tests passed
# # tests 5
# # pass 5
```

---

## 🔧 DB 경로 주입 지원

### openDatabase 확장
```javascript
// 기본 경로 사용
const { db } = openDatabase();

// 커스텀 경로 사용 (테스트용)
const { db } = openDatabase(':memory:');
```

---

## 📚 문서

### Phase 2-3 Planning 업데이트
- [docs/phase2-3-planning.md](../docs/phase2-3-planning.md)
- 명칭 정합 완료
- Phase A 계획 업데이트

---

## 🎯 다음 단계

### Phase B: Lock + 재시도 정책 + 알림
- [ ] Distributed Lock 통합
- [ ] q00-diet-religion EnhancedAlertManager와 통합
- [ ] 통합 테스트 작성

---

## ✅ 체크리스트

- [x] Task Queue API 구현 (enqueue/claim/start/complete)
- [x] 명칭 정합 (q00-diet-religion 통일)
- [x] 재시도 로직 (exponential backoff)
- [x] Dead Letter Queue 처리
- [x] Event Log 연동
- [x] 테스트 5개 통과
- [x] DB 경로 주입 지원
- [x] 문서 업데이트

---

**Commit:** `f4a2f9a`  
**Author:** 회사재귀 (HoesaJaegyu)  
**Reviewer:** 집재귀 (PrivateJQ)
