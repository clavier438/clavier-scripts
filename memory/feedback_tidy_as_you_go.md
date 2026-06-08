---
name: feedback_tidy_as_you_go
description: 진행하며 정리정돈하라 — 작업 단위마다 즉시 커밋·정리, 미정리 흔적을 다음 작업으로 넘기지 말 것
metadata:
  type: feedback
---

진행하며 정리정돈을 안 하고 미루니까 같은 사고가 자주 난다. 정리는 turn 끝/사후가 아니라 **작업 단위(=관심사 하나)를 끝낼 때마다 즉시** 한다.

**Why:** 2026-06-08 사용자 지적 — "평소에 정리정돈을 안 하며 진행하니까 이런 일이 자주 발생." 한 세션에서 미커밋 편집·stray 브랜치·중복 spawn(이미 도는 칩 모르고 백그라운드 Agent 또 launch)·교차-repo 편집이 줄줄이 누적됐고, 충돌·혼동이 *터진 뒤에야* 수습했다. 사후 수습은 이미 늦다 — 누적된 미정리 상태 자체가 다음 사고의 연료다.

**How to apply:**
- **작업 단위마다 닫기**: 관심사 하나를 끝내면 즉시 커밋/정리하고 다음으로. 미커밋 변경·stray 로컬 브랜치·orphan worktree·미보고 백그라운드 작업·임시 스크립트를 *다음 작업으로 넘기지 말 것*.
- **착수 전 확인 (중복 방지)**: 병렬·백그라운드·위임(`Agent run_in_background`/`spawn_task`/작업용 `git checkout -b`) 시작 전에 *같은 일이 이미 도는지*(눌린 칩·러닝 에이전트·기존 브랜치) 먼저 확인. 추측으로 또 띄우지 말 것.
- **한 세션 = 한 repo**: cross-repo 작업 금지. 다른 repo(예: clavier-hq) 는 그 repo 루트 세션에서. (before-action 훅이 이미 강제 — 거스르지 말 것.)
- **응답 전 self-reconcile**: 끝내기 전에 *이번 turn 에 내가 만든* 브랜치/worktree/백그라운드/임시파일 중 미정리가 있나 훑고 닫는다.

이건 [[feedback_ownership]](떠넘기지 말고 완수) · [[feedback_pr_srp]](한 PR=한 관심사, main 에서 분기) · [[feedback_followthrough]](위임 추적) 의 *실행 위생* 짝이다. 같은 정신을 "진행 중 계속" 으로 적용.
