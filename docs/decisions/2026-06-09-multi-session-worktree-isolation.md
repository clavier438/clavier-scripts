# 2026-06-09 — 멀티세션 브랜치 충돌의 근본 차단: git worktree 격리 (wt front door)

> 이 ADR 은 **repo-scoped (leaf)** — 콜로니의 git 작업 격리 구조.
> 상위 결정 = clavier-hq/DECISIONS.md 2026-06-09 "멀티세션 worktree 격리" (cross-repo).

---

## 증상 (사용자 표현)

> "브랜치가 바뀌고 지랄병나는 거, 언제부턴가 되게 자주 있다."

- 한 세션이 만든 브랜치가 다른 세션에 의해 갈아끼워짐.
- 커밋이 의도와 다른 브랜치에 얹힘.
- 작업 중 다른 세션이 PR 을 머지해 main 이 움직임.
- 같은 주제로 중복 브랜치가 생김.

**실측 (2026-06-09):** 작업 중 작업트리 브랜치가 의지와 무관하게 연쇄 전환
(`chore/disable-behavioral-verifier-hooks` → `feat/lut-tool` → `refactor/dedup-cli-prompt`).
그 사이 다른 세션이 PR #116 을 머지. 그 결과 canonical-검사 제거 커밋(`90a475c`)이
의도한 `chore/gc-zombie-canonical-clone-check` 가 아니라 `refactor/dedup-cli-prompt`
브랜치에 착지. 같은 canonical 작업이 **3+ 브랜치**(`rm-canonical-check`(→#118 머지),
`feat/canonical-clone-guard`, `gc-zombie-…`)로 중복.
(선례: clavier-hq/RAY_DALIO_QUEUE.md 2026-06-08 "위임 중복 착수 + 브랜치 충돌 직전".)

## 근본 원인

**단일 공유 작업트리 + 다중 세션 + 조율 부재.**

콜로니(environment-peer 모델, 2026-05-03)는 한 호스트에 repo 당 *단일 클론* 을 둔다.
그런데 여러 Claude 세션 — 메인 + `spawn_task` 칩(별도 세션이 같은 클론을 checkout) +
`isolation:worktree` 가 아닌 백그라운드 Agent — 이 그 *하나의 작업트리* 를 공유한다.

`git checkout`/`git switch` 는 **작업트리 전역 상태**다. 한 디렉토리에서 두 에이전트가
동시에 다른 브랜치를 가지려 하면 필연 충돌한다: 세션 A 가 브랜치 X 에서 일하는 동안
세션 B 가 `git checkout Y` 하면 A 의 작업트리도 Y 가 되고, A 의 다음 커밋이 Y 에 얹힌다.

**왜 그동안 worktree 로 안 갈라졌나:** `hooks/pre-commit` 의 검사 (4) "Mac 호스트별 단일
클론 강제" 가 `~/bin` alias 가 가리키는 클론만 canonical 로 인정하고 그 외(특히 git
worktree)의 commit 을 차단했다. → worktree 격리가 *커밋 불가* → 모두가 단일 클론에 몰림
→ 충돌 구조 고착. 그 검사는 environment-peer ADR(2026-05-03)이 폐기한 규칙의 좀비였고,
2026-06-09 #118 로 제거됨. **그 제거가 worktree 격리를 비로소 가능케 한 전제.**

## 결정 — 구조 3겹 (권유 아닌 장치)

정석 해법 = **git worktree**: 세션마다 독립된 작업 디렉토리(`~/dev/clavier/.worktrees/`)
+ 공유 `.git`. 한 세션의 checkout 이 다른 세션을 건드릴 수 없다. 이를 *기본 경로* 로 만든다.

| # | 장치 | 위치 | 역할 |
|---|---|---|---|
| 1 | **`wt` front door** | `tools/wt.sh` → `~/bin/wt` | 격리를 한 줄로. 옳은 길을 *싸게* 만든다 |
| 2 | **session-start 지형 주입** | `tools/claude-hooks/session-start.sh` | 매 세션 worktree 지형 주입. 위험을 *보이게* 한다 |
| 3 | **Sentinel `wt audit`** | clavier-hq routine (STL 소속) | stray 브랜치·orphan worktree 야간 목록화. *치우는* 그물 |

### `wt` (장치 1)

- `wt new <branch>` — 현재 repo 의 `origin/main` 기준 새 worktree+브랜치 생성, 경로를 stdout
  으로(`cd "$(wt new …)"` 가능). 생성 전 로컬/origin 동명 브랜치·중복 tip-subject 를 검사해
  **중복 착수**(증상 #3)를 경고·차단.
- `wt list` — worktree + 브랜치 + ahead/behind + dirty.
- `wt rm <name>` — worktree 제거 + 머지된 브랜치 자동 삭제 제안.
- `wt audit` — **읽기 전용** 리포트(upstream-gone / origin-main 머지 / orphan worktree /
  중복 tip-subject). 자동 mutate 안 함(사용자 통제 보존). Sentinel 야간 + 사람 공용.
- repo-aware: clavier-scripts / clavier-hq / platform-workers 어디서든 동작.

### session-start 지형 주입 (장치 2)

매 세션 `git worktree list` 를 읽어 현황 + `wt` 안내를 컨텍스트에 주입. 공유 콜로니 클론이
main 이 아니면(= 다른 세션이 그 작업트리를 점유 중) 경고를 격상. 네트워크 안 씀(로컬만).
→ "이 클론에서 `git checkout <다른-브랜치>` 금지, 작업은 `wt` 로 격리" 규칙을 *매번 보이게*.

### 왜 *차단(blocking) hook* 이 아닌가

`git checkout` 을 PreToolUse 로 차단하는 안도 검토했으나 **기각**. 직전(#114)에 행동 감시
agent hook 2개가 *정당한 작업을 오발 차단*해 비활성화됐다 — 같은 over-blocking 실수의
반복 위험. git 명령 인자를 hook 에서 robust 하게 파싱하기도 취약(false-positive = 사용자
폭발). 따라서 **차단이 아니라 (a) 옳은 길을 싸게(wt) + (b) 위험을 보이게(주입) + (c) 야간
청소(audit)** 로 — 마찰 없이 흘림 자체를 줄인다. (비유: "물 흘리기 좋은 환경을 고친다.")

## 결과 / 적용

- `tools/wt.sh` 신규 → `installScripts.sh` 가 `~/bin/wt` 로 자동 배포(추가 배선 0).
- `tools/claude-hooks/session-start.sh` 확장(지형 주입). settings.json 은 경로 참조 → 즉시 반영.
- Sentinel 야간에 `wt audit` 추가는 clavier-hq 측(routine 소속, STL).

## 참조

- clavier-hq/DECISIONS.md 2026-06-09 "멀티세션 worktree 격리" (상위 cross-repo ADR).
- clavier-hq/DECISIONS.md 2026-05-03 "environment-peer 모델" (단일 canonical 폐기 — 이 좀비 검사의 모순 출처).
- `hooks/pre-commit` 헤더 "(제거됨 2026-06-09) 단일 클론 강제" (#118).
- clavier-hq/RAY_DALIO_QUEUE.md 2026-06-08 (같은 뿌리, 제안 A/B/C).
- `memory/feedback_single_solution` (반복 실수는 권유 아닌 구조로만 막힌다).
