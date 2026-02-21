# Agent Orchestrator Phase 1

This repository is a Phase 1 proof-of-concept for a resilient agent orchestrator that avoids losing context on restarts, prevents duplicate execution, and handles concurrent work safely.

## Why this started
This project started from a practical pain point: when coordinating between Company-agent and Home-agent across different machines, the session context was often effectively fragmented.
- When a Company-agent session restarted, it had to repeatedly re-check memory/state.
- Session continuity, concurrent handoffs, and duplicate work were not reliable.

To keep agent collaboration alive through failures, we decided to use a durable state model and explicit recovery flow.

## Decision history summary
- Phase 1 scope was fixed to 4 core APIs:
  - `claimTask`
  - `heartbeat`
  - `releaseTask`
  - `staleRecovery`
- DB strategy: start with local independent SQLite on each machine at `${HOME}/.openclaw/data/orchestrator.db`.
- Shared DB (PostgreSQL) was deferred to later phases when live cross-machine state is required.
- `event_log` was made append-only and required for traceability.
- Validation is scenario-driven, with 4 core tests plus stale recovery and consistency checks.

## Roles
- **JQ (Owner / Origin):** Decision maker and final approver
- **집재규 / Home-agent:** Architecture guard, review, and validation
- **회사재규 / Company-agent:** Implementation, execution, and integration

## Implemented components
- `agent-orchestrator/`
  - `src/db.js`
  - `src/schema.sql`
  - `src/init-db.js`
  - `src/orchestrator.js`
  - `src/staleRecovery.js`
  - `src/test.js`
  - `.gitignore`

## What it does
- `claimTask()` acquires a session lock and marks one task as running.
- `heartbeat()` extends lock/session lease and proves liveness.
- `releaseTask()` finalizes task outcome and releases lock/state.
- `staleRecovery()` detects stale sessions (heartbeat + lock expiry) and recovers in-flight work.
- `event_log` records all state transitions for reproducibility.

## How to run
```bash
cd agent-orchestrator
npm install
npm run init-db
npm test
```

Expected output includes `ALL TESTS PASSED`.

## Current status
- Phase 1 implementation is merged into `main`.
- Core acceptance criteria are complete:
  - lock contention handling
  - duplicate prevention
  - stale recovery
  - no `node_modules` tracked in git
- Next: optional Phase 2 to move to shared DB backend when required.

## Governance notes
- Commits and reviews include explicit role metadata for traceability (`Author`, `Reviewer`, `Source`).
- PRs should reflect who wrote and who reviewed each change.

## Contributors

### Phase 1 (2026-02-22)
- **회사재규 (Company Agent)**: Core implementation
  - SQLite schema design
  - `claimTask` / `heartbeat` / `releaseTask` / `staleRecovery`
  - Test scenarios
  - Merge to main

- **집재규 (Home Agent)**: Design guard & review
  - Project history and decision documentation
  - Bilingual README and project onboarding docs
  - Commit/review traceability rules

### Commit ownership ledger (historical)
To avoid force-push churn, ownership records are now tracked here for the current rewritten history.

- `b5ebb91` -> `feat: implement sqlite phase1 orchestrator core (company-agent)`
- `96c4fe2` -> `docs: add project origin and phase-1 intent (company-agent)`
- `9d26619` -> `chore: add node_modules to .gitignore (company-agent)`
- `bf0b099` -> `docs: add phase1 project history, roles, and execution summary (home-agent)`
- `07c42a6` -> `docs: clarify phase1 origin from session memory-loss pain point (home-agent)`
- `4a2f9d5` -> `docs: normalize Phase 1 commit ownership mapping (home-agent)`
- `2c079e1` -> `docs: add contributors section for phase 1 (home-agent)`
- `47f08a8` -> `docs: add contributors mapping in Korean README (home-agent)`

This list is an explicit handoff note; future commits should continue using `(company-agent)` / `(home-agent)` tags in commit subjects.
