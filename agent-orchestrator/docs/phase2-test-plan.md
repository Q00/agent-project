# Phase 2 Test Plan

## 목표
Phase 2의 핵심은 기능 추가가 아니라 **동일 동작 보장**입니다.
SQLite와 PostgreSQL 경로를 같은 시나리오로 검증합니다.

## 기본 테스트 (필수)
1. **claim/release 흐름 유지**
   - seed session + claimTask
   - heartbeat
   - releaseTask
   - event_log 및 session_state 상태 정합성 확인

2. **동시 claim 경쟁**
   - 같은 session에 2개 claim 동시 호출
   - exactly one만 success
   - 실패 건은 idempotency 또는 busy reason 체크

3. **stale takeover**
   - claim 후 lock 만료 유도
   - 두 번째 에이전트가 lock 재획득
   - stale recovery 상태/태스크 반영 일치

4. **중복 실행 스킵**
   - 동일 조건 claim 재호출 시 재생성 없는지 확인
   - event_log 미증가/중복 처리 로그 존재 여부 확인

## Phase 2-1 추가 테스트
5. **Schema compatibility smoke (PostgreSQL 모드)**
   - `schema_postgres.sql` 적용
   - session/task/lock/event insert/select 기본 동작
   - FK/index 존재 여부 확인

6. **cross-driver 정합성 테스트**
   - `ORCH_DB_DRIVER=sqlite`와 `postgres`에서 동일 입력에 대한
     event/type/state 결과 비교(가능한 범위에서)
   - 이벤트 시퀀스 증가 규칙 동일성 점검

## 운영 지표 기본 검증
7. **lock expiry 이벤트 추적**
   - 스크립트 기반으로 lock 만료/중복 스킵/회수 횟수 집계
   - 재시작/복구 후 값 회귀 없음

## 완료 조건
- 기존 Phase 1 회귀 테스트 4개 통과 유지
- Phase 2-1 기준 테스트 통과
- 문서와 README에 새 테스트 실행 명령 업데이트
