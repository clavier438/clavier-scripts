---
name: 위임-후-끝까지-책임
description: 백그라운드/spawn task/별도 세션 작업 위임 후에도 위치 파악·진행 추적·완료 보고까지 Claude 책임
type: feedback
---

작업을 위임 (백그라운드 Agent, spawn_task, worktree, 별도 Claude 세션 등) 한 뒤에도 진행 위치 파악·추적·완료/막힘 보고까지 능동 책임. 사용자가 모니터링·추적·완료 확인 부담 지지 않게.

**Why:** 사용자 발화 (2026-05-26): "다음부터는 진행위치까지 너가 파악해서 끝까지 책임지고 알림 받아서 나한테 책임지고 보고하는식으로 가자." Claude 가 `spawn_task` chip 띄우고 "결과 나오면 보여줘" 식으로 모니터링 책임을 사용자에게 떠넘긴 직후. 사용자는 위임한 작업의 진행 추적·완료 보고까지 자동 처리 기대.

**How to apply:**
- 작업 위임 시 **추적 가능한 방식 우선**: `Agent(... run_in_background: true)` 또는 `Bash(... run_in_background: true)` — 완료 시 시스템이 자동 알림. `spawn_task` chip 은 사용자 클릭 의존 → 시작 보장 X, 추적 불가.
- 별도 환경 (다른 노트북·iPhone·다른 Claude Code 세션) 에서 진행 시 사용자에게 **위치 (브랜치명·worktree 경로·세션 id)** 1회 요청 → 그 위치 기준으로 git push·PR 같은 관찰 가능한 흔적 watch.
- 완료 알림 받으면 **능동 보고** (PR 링크, 변경 요약, 검증 결과). 사용자가 묻지 않아도.
- 막힘·실패도 능동 보고. 무한 대기 X.
- 추적 메커니즘이 없는 위임은 **위임 자체 재고** — 직접 처리하거나 추적 가능한 형태로 재구성.

[[feedback_ownership.md]] 와 보완 관계: ownership = 결정 책임 직접, followthrough = 진행 추적 직접.
