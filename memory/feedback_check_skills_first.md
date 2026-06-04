---
name: feedback-check-skills-first
description: 다단계 작업 시작 전 available skills + ~/.claude/skills 레지스트리를 먼저 확인 — 손으로 짜기 전에
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 542bac8e-d736-40a0-be1f-f29bea3f55d1
---

여러 단계가 필요한 작업(수집→CSV→Airtable 등)을 시작할 때, 손으로 도구를 조합하기 **전에** available skills 목록과 `~/.claude/skills`(→ clavier-scripts/skills) + `~/bin` CLI 에 이미 그 워크플로우를 캡슐화한 스킬/도구가 있는지 먼저 확인한다.

**Why:** 2026-06-03 Atelier Dyakova 웹사이트 수집 때 바로 curl+MCP 로 손코딩 시작 → 사용자가 "아마 스킬이 있을건데 확인했나" 로 교정. 실제로 `agency-web-collector` 스킬이 정확히 그 작업(에이전시 포트폴리오→webDesignModel 태깅)을 이미 담고 있었다. 스킬엔 dedup·필드 ID 매핑·CSV 규약·typecast 등 손코딩이 빠뜨릴 디테일이 박혀 있다.

**How to apply:** 착수 전 (1) system-reminder 의 available-skills 리스트 스캔 (2) 매칭 모호하면 `ls ~/.claude/skills` + `~/bin` 확인 (3) 있으면 그 스킬/도구 경로로 간다. 매칭 스킬은 BLOCKING — 다른 행동 전에 먼저 호출. [[feedback_reference_class]] 의 harness-내부 버전.
