# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Phase B: Distributed Lock 통합 (예정)
- Phase B: q00-diet-religion EnhancedAlertManager 통합 (예정)
- Phase B: 통합 테스트 작성 (예정)

---

## [0.1.0] - 2026-02-27

### Added

#### Phase A: Task Queue API 구현

**Task Queue API:**
- `enqueueTask()` - 태스크 생성 + 중복 방지 (dedupe_key)
- `claimNextTask()` - 우선순위 기반 태스크 획득
- `startTask()` - 태스크 실행 시작
- `completeTask()` - 태스크 완료/실패/재시도/dead letter

**명칭 정합 (q00-diet-religion 통일):**
- `task_type` → `kind` (통일)
- `pending` → `queued` (통일)
- 상태 전이: `queued/claimed/running/done/failed/dead`

**Task Kind:**
- `trade.decide`
- `kpi.dailyReport`
- `maintenance.reconcile`
- `agent.orchestrate`

**재시도 로직:**
- 실패 시 자동으로 `queued` 상태로 복귀
- Exponential backoff로 `next_retry_at` 계산
- `max_retries` 초과 시 dead letter로 이동

**Event Log 연동:**
- 모든 상태 변경을 `event_log`에 기록
- `idempotency_key`에 `event_seq` 사용 (중복 방지)

**스키마 수정:**
- `status` 기본값: `'pending'` → `'queued'`
- `max_retries` 컬럼 추가 (기본값 3)
- `heartbeat_at` 컬럼 추가

**DB 경로 주입 지원:**
- `openDatabase(customPath = null)` 확장
- 테스트용 `:memory:` DB 지원

**테스트:**
- ✅ 5개 테스트 통과
  - enqueue → claim → complete flow
  - priority ordering
  - dedupe_key prevents duplicates
  - dead letter on max retries exceeded
  - no tasks available

**문서:**
- Phase 2-3 Planning 문서 업데이트 (`docs/phase2-3-planning.md`)
- 명칭 정합 완료
- Phase A 계획 업데이트

### Changed

#### `agent-orchestrator/src/db.js`
- 전역 `dbPath` 상수를 `defaultDbPath`로 변경
- `openDatabase(customPath = null)`로 확장
- `customPath`가 있으면 우선 사용

#### `agent-orchestrator/src/schema.sql`
- `task_queue.status` 기본값 변경: `'pending'` → `'queued'`
- `task_queue.max_retries` 컬럼 추가
- `task_queue.heartbeat_at` 컬럼 추가

#### `agent-orchestrator/src/init-db.js`
- `initSchema(db)` 함수 export 추가
- CLI 사용과 프로그래밍 사용 모두 지원

### Fixed

- **DB 경로 주입 문제 해결** - 테스트에서 `:memory:` DB 사용 가능
- **Idempotency key 중복 문제 해결** - `event_seq` 사용으로 중복 방지

---

## [0.0.1] - 2026-02-25

### Added

#### Phase 1: Core Orchestrator

**Core Features:**
- `claimTask()` - Distributed lock 기반 태스크 획득
- `heartbeat()` - 워커 생존 신고 (2분 TTL)
- `releaseTask()` - 태스크 완료 후 해제
- `staleRecovery()` - 만료된 락 자동 정리

**Infrastructure:**
- SQLite WAL mode 활성화
- `distributed_lock` 테이블 구현
- `session_state` 테이블 구현
- `event_log` 테이블 구현

**Retry Policy:**
- `executeWithRetrySync()` - 재시도 로직 래퍼
- `getNextRetryAt()` - Exponential backoff 계산
- `isRetryable()` - 재시도 가능 에러 판단

**Dead Letter Handler:**
- `addDeadLetter()` - Dead letter 적재
- `getDeadLetters()` - Dead letter 조회
- `replayDeadLetter()` - Dead letter 재처리

**Alert Rules:**
- `AlertRules` 클래스 - 기본 알림 규칙
- `DefaultAlertManager` - 기본 알림 관리자

**Lock Monitor:**
- `LockMonitor` 클래스 - 락 상태 모니터링
- `getLockStats()` - 락 통계 조회

**Metrics:**
- `Metrics` 클래스 - 메트릭 수집
- `recordMetric()` - 메트릭 기록
- `getMetrics()` - 메트릭 조회

---

## Version History

- **0.1.0** (2026-02-27) - Phase A: Task Queue API 구현
- **0.0.1** (2026-02-25) - Phase 1: Core Orchestrator

---

**Maintainers:**
- 회사재귀 (HoesaJaegyu) - 실행/구현/운영
- 집재귀 (PrivateJQ) - 설계 가드/검증/기준값
