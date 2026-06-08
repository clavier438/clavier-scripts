# 2026-06-07 — reuse-first 스킬을 before-action 자리 축에 흡수 (별도 hook 아님)

> 이 ADR 은 **repo-scoped (leaf)** — agent hook 구조 변경.
> clavier-hq/DECISIONS.md 2026-05-29 "근본 3분류 agent hook(8→2 환원)" ADR 의 적용·연장.

---

## 맥락

`reuse-first` 스킬(#92 — 새 도구 작성 시 기존 `tools/lib/` 공유 바퀴를 먼저 재사용·조합하고 복붙 2곳+ 중복은 `tools/lib/` 로 추출, front door 패턴)이 지금은 *권유*(스킬 description 트리거)로만 존재한다. 사용자 요청: 권유가 아니라 **구조(agent hook verifier)로 강제**.

선택지:
1. 별도 hook `pre-tool-use.agent-reuse-first.md` 신설.
2. 기존 `pre-tool-use.agent-before-action.md` 의 **자리(Placement) 축에 흡수**.

## 결정

**별도 hook 을 만들지 않고, before-action 자리 축에 흡수한다.**

- 근거: **2026-05-29 ADR "8 hook → 2 환원"**(근거+자리 / 책임) 의 `memory/feedback_single_solution` 정신. 별도 hook 신설 = 권유 layer 를 다시 늘리는 것 = 환원에 역행.
- reuse-first(DRY·기존 바퀴 먼저·front door)는 자리 축(이미 단일뇌·SvelteKit·아키텍처 의도 포함)의 *자연스러운 한 항목*이다. "이 로직이 이미 lib 에 사는가?" 는 자리 축의 "같은 정보 다른 곳 중복 아닌가?" 와 동형.
- 자리 축 검증 기준에 **"재사용(reuse-first)"** 항목 추가: 새 .py/.mjs/.sh 작성 또는 헬퍼·기능 추가 시 — `tools/lib/` 공유 바퀴(또는 `skills/reuse-first/references/wheel-catalog.md`)를 먼저 확인했나, 같은 로직이 2곳+ 복붙되고 있지 않나, front door 따랐나. 위반 시 deny + "기존 바퀴 재사용 또는 lib 추출하라".

## 전파

- `tools/claude-hooks/pre-tool-use.agent-before-action.md` — 자리 축에 reuse-first 항목 + 2축 환원 설명 갱신 (이 ADR 직후 커밋).
- `settings.json` 은 이 파일 *경로* 를 참조 → 내용 수정만으로 즉시 반영 (bootstrap 재실행 불요).
- `reuse-first` 스킬(#92)은 권유(트리거)로 유지 — hook 은 강제 backstop. **스킬(권유) + hook(강제) 이중 방어**.

## 참조

- clavier-hq/DECISIONS.md 2026-05-29 "근본 3분류 agent hook".
- skills/reuse-first/ (#92), `memory/feedback_single_solution`.
