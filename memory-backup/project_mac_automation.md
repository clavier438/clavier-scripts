---
name: Mac 자동화 시스템 구조
description: iCloud/0/scripts 기반 자동화 시스템 전체 구조 — 스크립트 위치, 데몬, LaunchAgents, GitHub
type: project
originSessionId: a05b5723-8989-45df-93b1-11047ec8bb16
---
## 설계 철학 (중요)

**SvelteKit 방식** — 폴더 구조 자체가 아키텍처.

- 폴더 위치가 역할을 결정함. `daemons/`에 넣으면 데몬, 루트에 넣으면 일반 스크립트
- 하드코딩 금지. `$SELF_DIR`, `dirname`, 환경변수로 상대 참조
- installScripts가 폴더 구조를 그대로 `~/bin/`에 매핑 (`daemons/` → `~/bin/daemons/`)
- 새 스크립트 추가 시 "어느 폴더에 놓을까"가 "어떻게 설정할까"보다 먼저

**⚠️ 네이밍 컨벤션: 모든 파일/스크립트 이름은 camelCase 필수**
- 올바른 예: `statusBriefing.sh`, `connectSsh.sh`, `syncObsidian`
- 잘못된 예: `connect.sh`, `status_briefing.sh`, `ConnectSSH.sh`
- 폴더명은 소문자 단어 또는 camelCase (`clouds/`, `daemons/`, `webExporter/`)

**Why:** 하드코딩 제거 + 유연한 관리를 위해 사용자가 의도적으로 설계한 구조. 수정 시 이 철학을 깨지 말 것.

## 핵심 구조

- **소스:** `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` (iCloud) — 여기서만 수정
- **실행본:** `~/bin/` — LaunchAgent가 여기를 참조. `installScripts`로 iCloud → ~/bin 동기화
- **데몬 관리 명령어:** `~/bin/daemons/` 하위 스크립트로 관리
- **LaunchAgents:** `~/Library/LaunchAgents/com.clavier.*`

**Why:** macOS TCC 제한으로 LaunchAgent가 iCloud 경로 직접 실행 불가. iCloud=소스, ~/bin=실행 분리.
**How to apply:** 스크립트 수정은 항상 iCloud 소스에서, 수정 후 installScripts 실행 필요.

## 주요 데몬

| 데몬 | 역할 | 관리 명령 |
|---|---|---|
| syncObsidian | Obsidian iCloud → Google Drive 실시간 rsync | `~/bin/daemons/syncObsidian start\|stop\|restart\|status` |
| syncScriptable | Scriptable iCloud → Google Drive 실시간 rsync | `~/bin/daemons/syncScriptable` |
| watcherSync | syncObsidian/syncScriptable 감시/자동재시작 | LaunchAgent (5분 주기) |
| watcherScripts | scripts 폴더 변경 감지 → installScripts 실행 | LaunchAgent (WatchPaths) |
| watcherGitSync | scripts 폴더 변경 감지 → gitSync 실행 | LaunchAgent (WatchPaths + 5분 주기) |
| obsidianTagSync | Obsidian 태그 → macOS Finder 태그 동기화 | `~/bin/daemons/obsidianTagSync` |
| gitSync | scripts 폴더 변경사항 자동 git commit + push | `~/bin/daemons/gitSync` |
| workerPdf | PDF 처리 워커 | LaunchAgent |

**syncObsidian/syncScriptable는 자주 죽음** — statusBriefing이 터미널 시작 시 자동 재시작하도록 설정됨.

## 주요 경로

| 항목 | 경로 |
|---|---|
| 스크립트 소스 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` |
| 환경변수/토큰 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/env.md` |
| secrets 파일 | `~/.config/clavier/secrets` |
| PID 파일 | `~/.local/run/*.pid` |
| 로그 | `~/Library/Logs/` |
| Obsidian vault | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/` |
| Google Drive | `~/Library/CloudStorage/GoogleDrive-hyuk439@gmail.com/My Drive/` |

## GitHub

- **repo:** `https://github.com/clavier0/clavier-scripts` (private)
- **계정:** clavier0
- **token 위치:** env.md
- scripts 폴더 변경 시 watcherGitSync → gitSync → 자동 커밋+push

## Git 커밋 태그 컨벤션

| 태그 | 의미 |
|---|---|
| `[arch]` | 아키텍처 변경 (LaunchAgent 추가/삭제, 데몬 구조 변경, 폴더 구조 개편) |
| `feat:` | 새 기능 |
| `fix:` | 버그 수정 |
| `refactor:` | 동작 변화 없는 정리 |
| `chore:` | 설정, 문서, 기타 |

`[arch]` 태그는 나중에 `git log --grep='\[arch\]'`로 아키텍처 변경 이력만 추적 가능.

## 상태 확인 명령어

```bash
statusBriefing          # 전체 데몬 상태 + 자동 재시작
launchctl list | grep clavier
~/bin/daemons/syncObsidian status
```
