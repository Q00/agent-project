# Agent Orchestrator Phase 1 (SQLite)

This repository is a reliability-first Phase 1 PoC for an agent orchestrator that can continue working across session resets, concurrent execution, and process restarts.

## Why this project started
House-agent (implementation) and Company-agent (execution) often run on different machines.
In practice, state kept only in memory/files caused:
- lost context after reset
- duplicated work under concurrency
- hard-to-debug crashes with no reliable recovery trail

So we built this as the foundation for a recoverable execution loop:
- single source of truth for session state
- safe lock/lease flow
- idempotent task handling
- event-sourced logs for replay and debugging

## What we are building
### Core goals
- Preserve session continuity
- Prevent duplicate/colliding execution
- Auto-recover stale/inactive sessions

### Core APIs
- `claimTask()` — start a unit of work + acquire lock
- `heartbeat()` — emit alive signals and extend lease
- `releaseTask()` — finalize task result and release lock
- `staleRecovery()` — recover stale sessions and requeue unfinished work
- `event_log` — append-only audit trail for consistency checks

## Repository structure
- `src/db.js` : DB connection/config
- `src/schema.sql` : schema definitions
- `src/orchestrator.js` : core orchestration logic (`claim/heartbeat/release`)
- `src/staleRecovery.js` : stale session recovery logic
- `src/test.js` : test scenarios

## How to run
```bash
cd agent-orchestrator
npm install
npm run init-db
npm test
```

## Test scenarios
1. claim + release success
2. concurrent claim (only one succeeds)
3. lock expiry take-over
4. duplicate claim is skipped (idempotent behavior)
5. stale recovery

## DB path
If `ORCH_DB_PATH` is not set, defaults to:
`${HOME}/.openclaw/data/orchestrator.db`

## Roles (current mode)
- **JQ (origin)**: product direction and decisions
- **Home-agent / 집재규**: design guard, review, and verification
- **Company-agent / 회사재규**: implementation and execution
- Current Phase 1 execution mode: local SQLite per machine + GitHub for code collaboration
- Future mode: shared backend (e.g., PostgreSQL) for true live shared state

---

## 한국어 보조 요약 (Secondary)
### 왜 만들었는가
회사재규(회사 맥북)와 집재규(집 맥북)에서 작업하다 보니,
메모/파일 기반 상태는 세션 리셋이나 동시 작업에서 쉽게 끊기고 충돌이 생김.

### 만들고자 한 것
- 상태의 단일 진실소스(session_state/event_log)
- 락 기반 동시성 제어
- 하트비트 + stale 감지 복구
- 중복 실행 방지

### 실행
`npm install` → `npm run init-db` → `npm test`

### 테스트
claim/release, 동시 claim, lock takeover, duplicate skip, stale 복구가 핵심입니다.
