# Agent Orchestrator Phase 1

이 저장소는 세션 재시작 시 컨텍스트 손실을 줄이고, 중복 실행을 방지하며, 동시성 충돌을 견고하게 처리하기 위한 에이전트 오케스트레이션의 Phase 1 PoC입니다.

## 시작 배경
회사재규(Company-agent)와 집재규(Home-agent)가 서로 다른 맥북에서 협업하던 중, 다음 문제가 반복되었습니다.
- 회사재규 쪽 세션이 재시작되면 기존 메모리/상태를 매번 다시 확인해야 하는 번거로움
- 상태의 지속성이 약해 작업 이관 시 충돌·유실 발생
- 동시 claim/retry 상황에서 정합성 관리의 어려움

이를 해결하기 위해 영속 상태 + 명시적 복구 흐름을 가진 오케스트레이션 기반을 만들기로 했습니다.

## 주요 결정
- Phase 1 범위 고정: 4개 핵심 함수
  - `claimTask`
  - `heartbeat`
  - `releaseTask`
  - `staleRecovery`
- 초기 DB 전략: 각자 머신에서 독립 SQLite 사용 (`${HOME}/.openclaw/data/orchestrator.db`)
- 실시간 공유가 필요해지면 PostgreSQL로 전환은 Phase 2로 분리
- 실패 추적을 위해 `event_log`를 append-only 감사 로그로 필수화
- 테스트 기반 검증(4개 시나리오 + stale 복구 + 정합성 체크) 채택

## 역할
- **JQ (재규 / 사용자 / origin)**: 최종 의사결정, 승인
- **집재규 (Home-agent)**: 설계 리뷰, 정합성/락/중복 처리 검증 가드
- **회사재규 (Company-agent)**: 구현 및 실행, 통합 반영

## 구현 내용
- `agent-orchestrator/`
  - `src/db.js`
  - `src/schema.sql`
  - `src/init-db.js`
  - `src/orchestrator.js`
  - `src/staleRecovery.js`
  - `src/test.js`
  - `.gitignore`

## 동작 요약
- `claimTask()` : 잠금 획득 + 태스크 실행 등록
- `heartbeat()` : 생존 신호 및 락 만료 연장
- `releaseTask()` : 작업 완료/실패 반영 및 락 해제
- `staleRecovery()` : heartbeat + 락 만료 기준으로 정지/죽은 세션 복구
- `event_log` : 모든 상태 전이 기록

## 실행 방법
```bash
cd agent-orchestrator
npm install
npm run init-db
npm test
```

정상 시 `ALL TESTS PASSED` 출력.

## 현재 상태
- Phase 1은 `main` 병합이 완료된 상태
- 승인 기준(락 충돌 처리, 중복 방지, stale 복구, 테스트 통과) 충족
- 다음 단계: 필요 시 PostgreSQL 기반 공유 상태 관리로 확장

## 추적 규칙
- 커밋/리뷰에는 작성자/리뷰자 정보를 남겨 역할 추적을 유지
- PR 본문과 코멘트에 `Author`, `Reviewer`, `Source` 메타 항목 반영

## Contributors

### Phase 1 (2026-02-22)
- **회사재규 (Company Agent)**: Core implementation
  - SQLite schema design
  - `claimTask` / `heartbeat` / `releaseTask` / `staleRecovery`
  - Test scenarios
  - Merge to main

- **집재규 (Home Agent)**: Design guard & review
  - Architecture review
  - Documentation
  - Code review & approval
  - README (KO/EN)