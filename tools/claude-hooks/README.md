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

hook 의 *설정 데이터*는 같은 폴더 안에 `<hook-name>.config.json` 으로 둔다 (cohesion). 예: `user-prompt-submit.config.json` = `user-prompt-submit.sh` 의 도메인·키워드·소스 매핑.

## 현재 등록된 hooks

### `session-start.sh` — SessionStart 컨텍스트 강제 주입
- `clavier-hq/MISSION/STATUS/QUEUE` 핵심 섹션 + `systemMap` 도면 (생성형) 매 세션 자동 주입.
- `clavier-hq` 위치 = sibling-first 자동 탐색 (CONCEPTS #15). `$REPO_ROOT/../clavier-hq` + `CLAVIER_HQ` env override.

### `user-prompt-submit.sh` — UserPromptSubmit 도메인 컨텍스트 주입
- 사용자 프롬프트에 키워드 매칭 시 해당 도메인의 `files[]` (정적 .md cat) + `recipe[]` (shell 명령 실행) 결과를 주입.
- `recipe[]` = **생성형 도큐**. `head <code>` · `git log` 등으로 코드·커밋 본체에서 매번 직접 추출 → 손글 사본 0, drift 0. 사용자 발화 2026-05-27 "git 자체에 로깅을 잘하면 그게 도큐멘테이션".
- `recipe[]` shell 명령에서 `$COLONY` env 사용 가능 (콜로니 root). 명령당 5초 cap.
- 도메인·키워드·소스 = `user-prompt-submit.config.json`. files 는 *콜로니 상대경로* (host-agnostic).

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
