# 시스템 아키텍처 — clavier 환경

> 이 파일: 전체 시스템 개요 + Mac 자동화 모듈 상세.
> 각 모듈 내부는 해당 repo의 ARCHITECTURE.md에만 기술한다.

## Claude에게 — 세션 시작 시

이 파일로 전체 구조 파악 → 작업 대상 모듈의 ARCHITECTURE.md 읽기 → `git log --oneline -10`으로 최근 흐름 파악.
PROGRESS.md는 없음. 진행 상황은 커밋 메시지로.

---

## 전체 시스템 개요

```
Airtable (데이터 원천)
  │
  └─(webhook / REST)──► platform-workers (Cloudflare) ──► Framer (UI)
                              │
                         health-check-worker (30분 cron)
                              │
                         Airtable system_registry (상태 기록)

iCloud (Obsidian / Scriptable)
  └─(Mac LaunchAgent)──► syncObsidian.py ──► GDrive: icloudSync/

Mac overnight-runner (03:00 매일)
  ├─ worker-ctl conduct   (워커 스냅샷)
  ├─ info-arch            (Notion 점검, 매일)
  └─ Conductor            (클린아키텍처 감사, 월요일만)
```

## 모듈 목록

| 모듈 | Repo | ARCHITECTURE.md 위치 |
|------|------|----------------------|
| **Mac 자동화** | `clavier0/clavier-scripts` | 이 파일 |
| **CF Workers** | `clavier0/platform-workers` | `iCloud/0/code/projects/platform-workers/framer-sync/ARCHITECTURE.md` |
| **시스템 상태** | `clavier0/clavier-hq` | `iCloud/0/code/projects/clavier-hq/` (MISSION/STATUS/QUEUE/DECISIONS) |

---

## Mac 자동화 모듈

### 설계 철학

| 원칙 | 내용 |
|------|------|
| 소스/실행 분리 | `iCloud/0/scripts/` 수정 → `installScripts.sh` → `~/bin/` 배포 |
| 하드코딩 금지 | 경로는 `$SELF_DIR`/`$HOME`, 키/토큰은 `~/.config/clavier/secrets` |
| 폴더 구조 = 아키텍처 | `tools/` `daemons/` `clouds/` `memory-backup/` 폴더 위치가 역할을 결정 |
| 네이밍 | 파일/스크립트: camelCase |

### 폴더 → 배포 매핑

| 소스 위치 | ~/bin 내 위치 | 용도 |
|----------|--------------|------|
| 루트 (`.sh`, `.py`) | `~/bin/` | 인프라 (`installScripts`, `setup`) |
| `tools/` | `~/bin/` (평면) | 사용자 유틸 명령 (`imgToWeb`, `pdfToImg`, `airtableGenericV5` 등) |
| `daemons/` | `~/bin/daemons/` | LaunchAgent가 호출하는 데몬 |
| `clouds/{svc}/` | `~/bin/clouds/{svc}/` | 서비스별 유틸 (namespace 구분) |
| `webExporter/`, `memory-backup/`, `Markdown2ID/` | 배포 안 함 | 프로젝트/데이터 폴더 |

### 데몬 (daemons/)

| 데몬 | 트리거 | 역할 |
|------|--------|------|
| `syncObsidian.py` | watcherObsidian / watcherCal | iCloud → GDrive API 직접 싱크 (범용, `--src`/`--gdrive-root`로 대상 지정) |
| `syncMemory.sh` | watcherMemory | Claude 메모리 → memory-backup/ rsync |
| `gitSync.sh` | watcherGitSync (5분 + 변경감지) | scripts 변경 → git commit + push |

### iCloud → GDrive 싱크 현황

| 소스 | GDrive 대상 | LaunchAgent | 캐시 |
|------|------------|-------------|------|
| Obsidian vault | `icloudSync/obsidianSync/` | `watcherObsidian` | `~/.cache/syncObsidian.json` |
| Scriptable `data/cal/` | `icloudSync/cal/` | `watcherCal` | `~/.cache/syncCal.json` |

### LaunchAgents

| Label | 트리거 | 실행 |
|-------|--------|------|
| `com.clavier.watcherScripts` | scripts 폴더 WatchPaths | installScripts |
| `com.clavier.watcherGitSync` | scripts 폴더 WatchPaths + 5분 | gitSync |
| `com.clavier.watcherMemory` | memory 폴더 WatchPaths | syncMemory |
| `com.clavier.watcherObsidian` | Obsidian vault WatchPaths | syncObsidian.py |
| `com.clavier.watcherCal` | Scriptable data/cal WatchPaths | syncObsidian.py (--src cal) |
| `com.clavier.watcherScreenshots` | Screenshots WatchPaths | 스크린샷 처리 |
| `com.clavier.workerPdf` | WatchPaths | pdfToImg 처리 |
| `com.clavier.overnight` | 매일 03:00 (StartCalendarInterval) | overnight-runner.mjs (conduct + info-arch + Conductor) |

### bin 명령어

| 명령 | 역할 |
|------|------|
| `ociIn` | SSH → OCI 서버 접속 |
| `ociStatus` | SSH → OCI 상태 브리핑 |
| `airtableUpload` | SSH → OCI airtable-upload 트리거 (deprecated, 현재 Mac 직접 실행) |
| `statusBriefing` | 터미널 시작 시 데몬 상태 + 서버 체크 |

### Claude Code 통합 (SessionStart hook)

**문제**: CLAUDE.md만으로는 모델이 "clavier-hq 먼저 읽기" 지침을 가끔 흘끔만 보고 작업으로 뛰어드는 경우 있음. 지침 의존 → 모델 의지 의존.

**해결**: `~/.claude/settings.json`의 SessionStart hook이 `tools/sessionStartContext.sh`를 호출하여 매 새 세션 시작 시 핵심 문서들을 컨텍스트에 강제 주입.

```
새 세션 시작
  ↓
SessionStart hook 발동
  ↓
sessionStartContext.sh 실행
  ├─ git pull clavier-hq (네트워크 실패 무시)
  └─ 3종 문서를 합쳐 JSON으로 stdout 출력:
       MISSION.md / SYSTEM_ENV.md   (clavier-hq)
       workerContextInject.sh       (워커 키워드 감지 시 ARCHITECTURE 자동 주입)
  ↓
Claude Code가 추가 컨텍스트로 자동 주입
```

> 7종 → 3종으로 줄인 이유: SessionStart hook 허용 한도(~10KB) 초과 방지. MANUAL/STATUS/QUEUE/ARCHITECTURE는 필요 시 세션 중 읽는 것으로 충분. env.md는 시크릿 포함이라 자동 주입 부적절.

스크립트 위치는 iCloud 소스(`tools/`)이고 hook은 그 절대경로를 호출 — `~/bin`에 의존하지 않음(소스 = 진실).

### 주요 경로

| 항목 | 경로 |
|------|------|
| 스크립트 소스 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` |
| 프로젝트 코드 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/` |
| 실행 바이너리 | `~/bin/` |
| 시크릿 | `~/.config/clavier/secrets` |
| Claude 메모리 | `~/.claude/projects/-Users-clavier/memory/` |
| 메모리 백업 | `iCloud/0/scripts/memory-backup/` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.clavier.*` |
| OCI 스크립트 | `ubuntu@168.107.63.94:~/oci-scripts/` |

---

## 변경 이력 (주요 아키텍처 변경만)

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-04-28 | 전체 시스템 개요 + 모듈 표 최신화 (OCI/framer-sync-worker/base-template-server-api 제거 → platform-workers/clavier-hq 반영). SessionStart hook 3종 문서 명시. overnight LaunchAgent 추가 |
| 2026-04-27 | `tools/overnight-runner.mjs` 신설 + `com.clavier.overnight` LaunchAgent (매일 03:00). conduct + info-arch + Conductor(월) 통합 실행 |
| 2026-04-27 | `tools/workerContextInject.sh` + UserPromptSubmit hook — 워커 키워드 감지 시 ARCHITECTURE.md 자동 주입 |
| 2026-04-26 | SessionStart hook 7종 → 3종 축소 (한도 초과 방지) |
| 2026-04-25 | `tools/sessionStartContext.sh` 신설 + `~/.claude/settings.json` SessionStart hook을 인라인 → 스크립트 호출로 단순화. clavier-hq 4종(MISSION/MANUAL/STATUS/QUEUE)을 강제 주입 대상에 추가. 모델 의지 의존을 시스템 강제로 격상 |
| 2026-04-25 | `tools/` 폴더 추가 — 루트의 유틸 스크립트 9개 이동(imgToWeb/pdfToImg/pdfToJpeg/renameKoToCamel/restoreQuickActions/runSafariTabsExport/scriptsList/airtableGenericV5/airtableUploadV5). installScripts.sh에 tools→~/bin 평면 배포 특별 처리 추가. 런타임 동작 무변화 |
| 2026-04-24 | ARCHITECTURE.md 모듈화 — 각 repo가 자기 모듈 기술, 이 파일은 개요+Mac 모듈만 |
| 2026-04-24 | syncObsidian.py 범용화 + cal 싱크 추가, GDrive icloudSync/ 통합 |
| 2026-04-22 | iCloud→GDrive 싱크 데몬 전체 정리, OCI 역할 Airtable→GDrive만으로 축소 |
| 2026-04-21 | OCI 브리핑 시스템, airtable-jobs 파이프라인, GDrive airtable/ 폴더 통합 |
| 2026-04-18 | Google OAuth 발급, OCI airtableGdriveSync.py, airtable-data GitHub repo |
| 2026-04-15 | statusBriefing 완전 동적화, 데몬 메타 주석 체계 |
