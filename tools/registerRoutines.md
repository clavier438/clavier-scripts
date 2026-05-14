---
description: clavier-hq/routines/*.md 를 Claude scheduled-tasks 로 일괄 등록 (포맷 후 Tier 3 부활)
---

# 작업

`clavier-hq/routines/*.md` 의 모든 routine spec 을 Claude scheduled-tasks 로 일괄 등록한다.

이 명령은 `bash setup.sh` 다음 단계 (Tier 3). bash 에서 MCP 호출 불가하므로 Claude 세션 안에서 분리 실행.

## 처리 절차

### 1. clavier-hq 위치 탐색 (sibling-first)

순서:
1. 환경변수 `$CLAVIER_HQ` 가 있으면 그것
2. sibling: `$(pwd)/../clavier-hq` 또는 `$(git rev-parse --show-toplevel)/../clavier-hq`
3. iCloud Mac fallback: `~/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/clavier-hq`
4. `~/clavier-hq` (OCI 관례)

찾으면 `$HQ/routines/` 가 존재하는지 확인.

### 2. routines/*.md 모두 읽기

`ls $HQ/routines/*.md` 결과에서 `README.md` 제외한 각 파일 Read.

각 파일은 frontmatter 가짐:
```
---
name: closer
description: 매일 03:00 — overnight 헬스 + 큐 + briefing
cronExpression: 0 3 * * *
---
<본문 — Claude prompt>
```

### 3. 기존 등록 확인

`mcp__scheduled-tasks__list_scheduled_tasks` 호출 → 이미 등록된 taskId 목록 파악.

### 4. 미등록만 등록 (idempotent)

각 routine 에 대해:
- `taskId` 가 이미 있으면 skip (또는 prompt 가 바뀌었으면 `mcp__scheduled-tasks__update_scheduled_task`)
- 없으면 `mcp__scheduled-tasks__create_scheduled_task` 호출:
  - `taskId`: frontmatter `name`
  - `cronExpression`: frontmatter `cronExpression`
  - `description`: frontmatter `description`
  - `prompt`: 본문 (frontmatter 제거 후 전체)

### 5. 마커 삭제

모두 성공 시:
```sh
rm -f ~/.clavier/routines-pending
```

### 6. 결과 보고

사용자에게 표 출력:
| routine | cron | 상태 |
|---|---|---|
| closer | 0 3 * * * | ✓ 등록 (또는 ✓ 이미 있음) |
| ray-dalio | 30 3 * * * | ✓ 등록 |
| sentinel | 45 3 * * * | ✓ 등록 |
| engineer | 30 3 * * 0 | ✓ 등록 |
| architect | 30 4 * * 1 | ✓ 등록 |

## 왜 이 패턴인가

- **manifest = directory** : `routines/` 디렉토리 자체가 SSOT. 새 routine 추가 시 파일만 떨어뜨리면 됨.
- **SRP** : setup.sh (bash) = Tier 1+2 (인프라 / LaunchAgent). 이 명령 = Tier 3 (Claude scheduled-tasks).
- **environment-peer** : 어느 환경에서 호출돼도 동일 — sibling-first 탐색.

## 참고

- master spec: `clavier-hq/routines/README.md`
- 폐기된 옛 prompt 들: `clavier-hq/archive/old-prompts-2026-05-10/`
