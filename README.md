# Agent Orchestrator Phase 1

이 저장소는 JQ 주도 하에 **에이전트 상태 유실/중복 실행/동시성 충돌** 문제를 줄이기 위해 만든 오케스트레이션 Phase 1 PoC입니다.

## 시작 이유
회사재규(실행)와 집재규(설계/리뷰)가 서로 다른 맥북에서 작업하면서,
에이전트 상태가 기억 상실되거나 동시 작업에서 충돌이 생기는 문제가 반복되어,
"에이전트가 죽어도 다시 살아나고, 다시 이어질 수 있는 안전한 실행 루프"가 필요했습니다.

## 지금까지의 대화/결정 흐름 요약
- Phase 1 목표를 **4개 핵심 함수**로 고정: `claimTask`, `heartbeat`, `releaseTask`, `staleRecovery`
- DB는 **초기에는 각자 독립 SQLite 실행**(로컬 `.openclaw/data/orchestrator.db`)으로 시작하고, 추후 필요 시 PostgreSQL 전환으로 확장
- 이벤트 소실/추적성 보완을 위해 `event_log` 기반 append-only 로그를 필수 설계로 확정
- 테스트 기반 운영: 4개 시나리오 + stale 복구 + 정합성 체크로 실패 원인 추적 가능한 형태로 설계

## 역할 분담
- **JQ (재규 / 사용자 / origin)**
  - 전체 방향 결정, 최종 승인, 통합 판단

- **집재규 (Home Agent / 너, 설계/검토 가드)**
  - 아키텍처 리뷰, 멱등성/락/복구 정합성 검증
  - PR 리뷰 및 승인 판단
  - README/추적 규칙 정리 및 협업 규약 관리

- **회사재규 (Company Agent / 실행 담당)**
  - 실제 코드 작성 및 실행
  - 스키마/코어 함수 구현
  - 테스트 작성 및 통합 실행, main 병합 반영

## 구현/커밋 하이라이트
- `agent-orchestrator` 프로젝트 생성
- 핵심 코드:
  - `src/db.js`, `src/schema.sql`, `src/init-db.js`, `src/orchestrator.js`, `src/staleRecovery.js`, `src/test.js`
- 보안/운영:
  - `.gitignore`에 `node_modules/`, SQLite 워크 파일 패턴 반영
- 실행/검증:
  - `npm install`
  - `npm run init-db`
  - `npm test`
  - 테스트 모두 통과 확인 (`ALL TESTS PASSED`)

## 현재 상태(요약)
- 회사재규가 구현 코드를 작성/반영했고, 병합이 main에 반영됨
- 회사재규/집재규는 역할 분담대로 진행했고, JQ에게 최종 승인 권한이 있음
- 추가 기능(공유 DB 전환 등)은 Phase 2 과제로 보류

## 역할 추적 규칙
- 커밋/리뷰에는 작성자/리뷰자 구분 태그를 남김
- PR 본문/코멘트에 `Author`, `Reviewer`, `Source` 등 메타 정보를 남겨 추적성 확보

## 목표 (Phase 1 종료 기준)
- 동시성 충돌 방지
- 세션 연속성 확보
- stale 복구 가능성 확보
- 중복 실행 최소화

## Note
회사재규는 현재 이 프로젝트를 실행/검증하고 있으며, 집재규는 리뷰/검증 가드로 동작 로그/정합성을 관리합니다.
