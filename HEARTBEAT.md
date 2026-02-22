# HEARTBEAT.md - Periodic Checks

## Active Checks

_(rotate through these, 2-4x/day)_

- [ ] Emails — anything urgent?
- [ ] Calendar — events in next 24h?
- [ ] Running agents / cron jobs — any failures or completions to report?
- [ ] JQ's active projects — anything needs attention? (git status, errors, etc.)

## Thresholds for Proactive Reach-Out

- Important email arrived
- Calendar event < 2h away
- Cron job failed
- Agent returned unexpected result
- It's been > 8h since last contact

## Quiet Hours

**Don't interrupt:** 23:00–08:00 KST (unless urgent)

## Current Reminders

- [x] PR #2 생성 및 병합 완료 확인
- [x] PR #2 merge 전후 실행 절차 고정
  - `git pull --ff-only`
  - `npm run init-db`
  - `npm test`
  - `node src/test_retry.js`
  - `node src/test_metrics.js`
  - `npm run metrics 60`
- [x] Phase 2-4 운영 안정성 구현 완료 상태 반영(알림/락 충돌/데드레터)

---

_Edit this freely. Delete completed items._

- [ ] Phase 3 임계치(수락안) 문서/적용 점검
  - `METRICS_THRESHOLD_STALE_RECOVERY_FAILURE_RATE=0.15`
  - `METRICS_THRESHOLD_ORPHANED_LOCKS=5`
  - `METRICS_THRESHOLD_DEAD_LETTERS_OPEN=5`
  - `METRICS_THRESHOLD_LOCK_CONFLICT_EVENTS=150`
  - `METRICS_THRESHOLD_RETRY_LIMIT_REACHED=1`
  - `METRICS_THRESHOLD_DUPLICATE_SUPPRESSED=20`
- [ ] Phase 3 PR 브랜치/PR 생성 (`feat/phase3-stress`)


## 2026-02-22 10:41KST - PR 생성 확인 요청
- PR #2(8b485d9) 생성 필요: `gh pr create` 미실행 상태 확인
- JQ가 PR 생성 및 병합 수행 전까지 상태 고정 모니터링 유지

## 2026-02-22 11:10KST - Audit 복원 후 정리
- 컴팩션 재부팅 알림 기준으로 워크스페이스 재점검 결과: `WORKFLOW_AUTO.md`는 현재 경로에 부재(ENOENT).
- `memory/2026-02-22.md` 기준 상태 점검을 기반으로 Phase 2-4 문맥 재정렬 완료.

## 2026-02-22 11:50KST - Phase 2-4 상태 정리
- Phase 2-4 운영 안정성 구현(알림/데드레터/락 이벤트)을 완료 상태로 확인.
- `npm test`, `node src/test_metrics.js`, `npm run metrics -- 60` 등 검증 체인 정상 동작을 재확인.
- `HEARTBEAT.md`의 항목을 운영 점검 체크리스트로 정리 및 완료 마킹 처리.

## 2026-02-22 11:32KST - Phase 3 임계치 수락 반영
- `alert_rules.js` 기본 임계치 수락안 적용 완료
- README 문서화: `Phase 3 임계치 권고값` 추가
- HEARTBEAT에 Phase 3 임계치 점검/PR 체크리스트 반영
- `METRICS_THRESHOLD_STALE_RECOVERY_FAILURE_RATE` 환경변수 alias 파싱 테스트 추가
- `npm test` + `node src/test_alerts.js` 통과
