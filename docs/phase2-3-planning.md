# Phase 2-3 Planning: Task Queue & Session Orchestration - UPDATED

**Created:** 2026-02-26 23:41 KST  
**Updated:** 2026-02-27 01:15 KST  
**Author:** 회사재귀 (Company Agent)  
**Reviewer:** 집재귀 (Home Agent) — pending approval

---

## 🎯 명칭 정합 (Q00 Diet Religion과 통일)

**중요:** q00-diet-religion 프로젝트와 스키마/명칭 통일

| 항목 | q00-diet-religion | agent-project (이전) | agent-project (통일) |
|------|-------------------|---------------------|---------------------|
| 테이블명 | `task_queue` | `task_queue` | ✅ `task_queue` |
| 타입 필드 | `kind` | `task_type` (계획) | ✅ `kind` |
| 상태 필드 | `queued` | `pending` (계획) | ✅ `queued` |
| 우선순위 | `priority` | `priority` | ✅ `priority` |
| 재시도 | `retry_count` | `retry_count` | ✅ `retry_count` |
| 중복방지 | `dedupe_key` | `dedupe_key` | ✅ `dedupe_key` |

**상태 전이 (통일):**
```
queued → claimed → running → done/failed/dead
                 ↘ cancelled (선택)
```

**Task Kind (통일):**
- `trade.decide`
- `kpi.dailyReport`
- `maintenance.reconcile`
- `agent.orchestrate`

---

## Phase A: Task Queue 활성화

### 목표
`task_queue` 테이블을 사용해서 실제 작업을 enqueue → claim → complete 루프 구현

### 작업 내역

#### A-1. Task Queue API 구현 (명칭 정합)

```javascript
// ✅ 통일된 API (q00 기준)
enqueueTask({ 
  task_id, 
  session_id, 
  kind,        // task_type → kind
  priority, 
  payload, 
  dedupe_key,
  max_retries 
})

claimNextTask({ 
  session_id, 
  owner_agent 
})  // priority 순, status=queued만

startTask({ 
  task_id, 
  owner_agent 
})

completeTask({ 
  task_id, 
  status: 'done' | 'failed' | 'dead',  // dead-letter 지원
  error_code?, 
  error_msg? 
})
```

#### A-2. 상태 전이 (통일)
```
queued → claimed → running → done/failed/dead
                 ↘ cancelled
```

#### A-3. Event Log 연동
- 모든 상태 변경을 `event_log`에 기록
- `event_type`: `task_enqueued`, `task_claimed`, `task_started`, `task_completed`, `task_failed`, `task_dead`

#### A-4. Dead Letter Queue
- `status=dead`인 태스크는 자동으로 dead-letter로 분류
- `max_retries` 초과 시 `dead` 상태로 전이
- Dead letter는 나중에 수동/자동 재처리 가능

#### A-5. 테스트
- enqueue → claim → complete 기본 흐름
- priority 순서 보장
- dedupe_key 중복 방지
- Dead letter 처리

### 완료 기준
- [ ] Task Queue API 4개 구현 (enqueueTask, claimNextTask, startTask, completeTask)
- [ ] 상태 전이 FSM 정의 (queued/claimed/running/done/failed/dead)
- [ ] Event Log 연동
- [ ] Dead Letter Queue 처리
- [ ] 테스트 5개 통과

---

## Phase B: Lock + 재시도 정책 + 알림

### 목표
동시성 제어 강화 + 실패 처리 자동화 + 운영 알림

### 작업 내역

#### B-1. Distributed Lock 통합
- `claimTask` 시 `distributed_lock` 테이블 사용
- Lock timeout + TTL 기반 자동 해제
- `lock_events` 테이블로 락 획득/반납 이력 추적

#### B-2. 재시도 정책
```sql
-- task_queue 필드 활용
retry_count INTEGER DEFAULT 0
next_retry_at TEXT
max_retries INTEGER DEFAULT 3  -- payload에 저장
```

- 실패 시 `retry_count` 증가
- `next_retry_at` 계산 (exponential backoff)
- `max_retries` 초과 시 → `status=dead`

#### B-3. 알림 시스템
- `alerts` 테이블 활용
- 재시도 초과, dead letter 적재, 락 충돌 등 이벤트 알림
- q00-diet-religion의 EnhancedAlertManager와 통합 가능

### 완료 기준
- [ ] Distributed Lock 통합
- [ ] 재시도 정책 구현 (exponential backoff)
- [ ] 알림 이벤트 로깅
- [ ] q00-diet-religion과의 통합 테스트

---

## Phase C: Session State Phase 연동 + 대시보드

### 목표
세션 상태를 FSM으로 관리하고, heartbeat와 연동해서 대시보드 제공

### 작업 내역

#### C-1. Session Phase FSM
```
idle → planning → executing → blocked → done → error
       ↑              ↓
       └──────────────┘ (retry)
```

- `session_state.phase` 필드 활용
- 각 phase 전이 조건 정의
- Event Log에 phase 변경 기록

#### C-2. Heartbeat 연동
- 기존 heartbeat는 `heartbeat_at`만 업데이트
- 추가: phase 변경, task 진행 상황도 heartbeat에 반영

#### C-3. 상태 대시보드
```bash
# CLI 대시보드
$ node dashboard.js
Session: discord-command-session
Phase: executing
Heartbeat: 2 min ago
Tasks: 3 running, 5 queued, 12 done, 2 failed
Locks: 1 active
```

#### C-4. Health Check API
```javascript
getHealth() // { status: 'healthy' | 'degraded' | 'unhealthy', details: {...} }
```

#### C-5. q00-diet-religion 통합
- q00의 모니터링 메트릭과 통합
- 동일한 CI/CD 파이프라인 사용
- 통합 대시보드 제공

### 완료 기준
- [ ] Session Phase FSM 구현
- [ ] Heartbeat 연동
- [ ] CLI 대시보드 구현
- [ ] Health Check API
- [ ] q00-diet-religion과의 통합 테스트

---

## 🚨 리스크 & 대안

### 리스크
1. **동시성 이슈**: SQLite는 동시 쓰기에 약함 → WAL 모드 사용 / PostgreSQL 전환 고려
2. **복잡도 증가**: FSM 전이 로직 복잡 → 단순화, 문서화
3. **명칭 충돌**: q00-diet-religion과의 명칭 불일치 → ✅ 해결 (통일 완료)

### 대안
- Phase A만 먼저 완료하고, B/C는 필요시 진행
- PostgreSQL 전환을 Phase B 전에 수행 (Phase 2 원안)
- q00-diet-religion의 기존 구현 재사용

---

## 📊 타임라인

| Phase | 예상 기간 | 우선순위 | 상태 |
|-------|----------|---------|------|
| A | 1-2일 | 높음 | 🔄 진행 중 |
| B | 2-3일 | 중간 | ⏸️ 대기 |
| C | 2-3일 | 중간 | ⏸️ 대기 |

---

## 🎯 다음 단계

1. **✅ 명칭 정합 완료** — q00-diet-religion 기준으로 통일
2. **Phase A 구현 시작** — enqueueTask API 구현
3. **테스트 주도 개발** — 각 단계마다 테스트 작성
4. **q00-diet-religion과 통합 테스트** — 호환성 검증

---

## 📚 참고 문서

- [q00-diet-religion RUNBOOK.md](../q00-diet-religion/docs/RUNBOOK.md)
- [q00-diet-religion OPERATIONS.md](../q00-diet-religion/docs/OPERATIONS.md)
- [q00-diet-religion Phase F 완료 문서](../q00-diet-religion/docs/)

---

**질문/제안?**  
<@1470833958945034340> 명칭 정합 완료했어! 이제 Phase A 시작해도 될까?
