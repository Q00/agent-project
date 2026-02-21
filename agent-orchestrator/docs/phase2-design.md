# Phase 2 Design: Shared-DB Migration (SQLite → PostgreSQL)

## 목표
- 현재 SQLite 단일 실행 구조를 유지하면서, 장기적으로 여러 맥북/에이전트가 동일 상태를 공유할 수 있도록 PostgreSQL 전환 경로를 마련한다.
- Phase 1의 동작 보장(락/이벤트/복구/멱등성) 조건을 깨지 않게 한다.

## 현재 상태 기준
- 단일 SQLite 스토리지 기준으로 4개 핵심 함수 동작 완료: `claimTask`, `heartbeat`, `releaseTask`, `staleRecovery`
- event_log 기반 상태 추적
- tests: claim/release, concurrent claim, stale recovery, duplicate skip

## 비기능 요구
1. 운영자 변경 최소: 기존 SQLite 사용 시 기존 코드 변경 최소화
2. 공유 상태 지원: PostgreSQL에서 동시 다중 에이전트 실행 시 race-safe 동작
3. 추적성 유지: event_log 및 status checkpoint 기준 불변
4. 무료 기반: 오픈소스/무료 인프라 가정

## 제안 아키텍처
### 1) Driver abstraction
- `ORCH_DB_DRIVER` 환경 변수로 드라이버를 분기
  - `sqlite` (default)
  - `postgres`
- 동일 API: `openDatabase({driver, connection})`

### 2) Schema alignment
- 기본 테이블/컬럼 유지
  - `session_state`, `task_queue`, `distributed_lock`, `event_log`
- PostgreSQL 맞춤 DDL 제공 (`schema_postgres.sql`)
- SQLite와 타입/인덱스 의미 매핑 유지

### 3) 동작 정합성 유지
- lock 조건: `expires_at`, heartbeat timeout, lock owner token
- stale 기준: heartbeat timeout + lock expiry 동시 조건
- 중복 실행: 이벤트 idempotency key 기반

## 단계별 작업
### Phase 2-1 (MVP)
- PostgreSQL DDL 추가
- DB 드라이버 추상화 적용
- adapter 분기 최소화
- 기존 테스트를 공통 인터페이스로 정리

### Phase 2-2
- Retry/Dedup 정책(회사재규): 정책 스키마 확장
  - `retry_count`, `next_retry_at`, `dedupe_key`
- 이벤트 집계 메트릭 추가

## 테스트 계획
- 기존 4개 시나리오 유지
- PostgreSQL 경로 동작 smoke test(로컬/Mock):
  - schema 적용 후 기본 insert/select/claim/release path
  - concurrent claim one-success
  - stale recovery
  - duplicate skip

## 완료 기준
- 기존 SQLite 테스트 100% 통과 유지
- PostgreSQL 전환 설계 문서 반영
- README/Contributors/운영 메타 갱신
- PR 템플릿 기준 승인 항목 충족
