# Agent Orchestrator Phase 1 (SQLite)

이 저장소는 `claimTask / heartbeat / releaseTask / staleRecovery`를 SQLite로 구현한 최소 PoC입니다.

## 구성
- `src/db.js` : DB 연결/초기 설정
- `src/schema.sql` : 스키마
- `src/orchestrator.js` : 핵심 3개 함수
- `src/staleRecovery.js` : stale 세션 복구
- `src/test.js` : 4개 테스트 시나리오

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

## DB 경로
환경변수 `ORCH_DB_PATH` 없으면
`${HOME}/.openclaw/data/orchestrator.db` 사용
