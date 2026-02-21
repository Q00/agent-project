# Agent Orchestrator Phase 1 (SQLite)

이 저장소는 **에이전트가 세션 리셋/동시성 충돌/중단 상황에서도 계속 이어질 수 있게** 만드는 신뢰성 오케스트레이션 PoC입니다.

## 왜 시작했나 (기원)
회사재규(실행)와 집재규(설계/가드)가 서로 다른 맥북에서 작업하면서,
"세션/작업 상태가 에이전트마다 사라지거나 꼬이는" 문제가 자주 생겼습니다.

그래서
- **메모리/파일 기반 상태의 휘발성**을 벗어나고,
- **작업 인계가 끊기지 않는 구조**를 만들고,
- **실험이 실패해도 복구 가능한 시스템**으로 바꾸자는 목적에서 시작했습니다.

최종 목표는 단순 기능 구현이 아니라,

- `세션 지속성`
- `동시성 충돌 방지`
- `자동 복구`

를 한 번에 확보해, `재시작해도 같은 의도로 돌아오는` 오케스트레이션 루프를 갖추는 것입니다.

## 구성
- `src/db.js` : DB 연결/초기 설정
- `src/schema.sql` : 스키마
- `src/orchestrator.js` : 핵심 3개 함수 + 상태 전이
- `src/staleRecovery.js` : stale 세션 감지 및 복구
- `src/test.js` : 테스트 시나리오

## 실행
```bash
cd agent-orchestrator
npm install
npm run init-db
npm test
```

## 테스트 시나리오
1. claim + release 성공
2. 동시 claim 중 한 개만 성공
3. lock 만료 후 takeover
4. 중복 claim skip
5. stale 복구

## 우리가 만들고자 한 것 (요약)
- `claimTask()` : 작업 시작 + 락 확보
- `heartbeat()` : 살아있음 신고 + TTL 연장
- `releaseTask()` : 작업 완료/실패 반영 + 락 해제
- `staleRecovery()` : heartbeat/락 만료로 죽은 세션 복구
- `event_log`를 통한 **append-only 감사 로그**로 추적 가능성 확보

## DB 경로
환경변수 `ORCH_DB_PATH` 없으면
`${HOME}/.openclaw/data/orchestrator.db` 사용
