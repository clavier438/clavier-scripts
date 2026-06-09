# Claude Code Hooks — 폴더가 함수다 (SvelteKit 정신)

> 파일 *위치*가 hook 등록을 결정. bootstrap.sh 가 이 폴더를 walk 해서
> `~/.claude/settings.json` 의 hooks 항목을 *생성*. 등록부 별도 없음.

## 컨벤션

| 파일 | 자동 등록 hook event |
|---|---|
| `session-start.sh` | `SessionStart` |
| `user-prompt-submit.sh` | `UserPromptSubmit` |
| `pre-tool-use.sh` | `PreToolUse` |
| `<kebab-case>.sh` | kebab → PascalCase event 자동 매핑 |

새 hook 추가 = 컨벤션 따라 파일만 만들면 끝. bootstrap ensure 가 즉시 settings.json 에 등록. 파일 삭제 = bootstrap 다음 실행이 settings.json 에서 제거. *stale 불가능*.

## 짝 데이터 파일

hook 의 *설정 데이터*는 같은 폴더 안에 `<hook-name>.config.json` 으로 둔다 (cohesion). 예: `user-prompt-submit.config.json` = `user-prompt-submit.sh` 의 도메인·키워드·파일 매핑.

## 현재 등록된 hooks

### `session-start.sh` — SessionStart 컨텍스트 강제 주입
- `clavier-hq/MISSION/STATUS/QUEUE` 핵심 섹션 + `systemMap` 도면 (생성형) 매 세션 자동 주입.
- `clavier-hq` 위치 = sibling-first 자동 탐색 (CONCEPTS #15). `$REPO_ROOT/../clavier-hq` + `CLAVIER_HQ` env override.
- **🌿 Git 작업트리 지형 주입** (멀티세션 브랜치 충돌 방지, 구조 장치 2/3): 매 세션
  `git worktree list` 를 읽어 현황 + 격리 안내(`wt new`)를 주입. 공유 콜로니 클론이
  main 이 아니면(= 다른 세션이 그 작업트리를 점유 중) 경고를 격상. 네트워크 안 씀.
  front door = `tools/wt.sh` (`~/bin/wt`), 야간 그물 = Sentinel `wt audit`.

### `user-prompt-submit.sh` — UserPromptSubmit 도메인 컨텍스트 주입
- 사용자 프롬프트에 키워드 매칭 (worker/airtable/cloudflare/framer/doppler/github 등 7 도메인) 시 해당 `capabilities/*.md` 자동 주입.
- 도메인·키워드·파일 = `user-prompt-submit.config.json`. files 는 *콜로니 상대경로* (host-agnostic).

### `pre-tool-use.sh` — Bash + run_in_background 차단 + 동반 sleep task 강제
- `Bash + run_in_background=true` 호출 시 동반 "주기적확인요망" sleep task 가 없으면 차단.
- Claude 가 백그라운드 작업 약속해놓고 polling 안 하는 turn-based 누락 방지.
- 자세한 설계는 파일 헤더 참조.

## 호출 메커니즘 (Layer 분류)

- **Layer 1 (콜로니, 진실)**: 이 폴더의 `*.sh` 파일들. git 추적.
- **Layer 2 (호스트 어댑터, 생성물)**: `~/.claude/settings.json` 의 hooks 항목. bootstrap.sh ensure 가 매번 이 폴더 walk 결과로 *재생성*.
- 사용자가 settings.json 을 직접 편집할 수 있으나 — bootstrap 다음 실행이 hooks 부분만 덮어씀 (다른 키 보존). drift 할 *대상*이 사라짐.

## 참고

- 공식 문서: <https://code.claude.com/docs/en/hooks.md>
- bootstrap 진입: `bash ~/dev/clavier/clavier-hq/bootstrap.sh ensure`
- 설계 ADR: clavier-hq/DECISIONS.md 2026-05-24 "콜로니 self-install"
