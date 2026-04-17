# 시스템 아키텍처 — clavier 환경

> **이 문서의 목적:** 전체 시스템의 구조와 설계 의도를 항상 최신 상태로 기록.
> 아키텍처가 바뀔 때마다 반드시 이 파일을 같이 업데이트할 것.
> Claude는 세션 시작 시 이 파일을 읽고 현재 시스템 상태를 파악한다.

---

## Claude에게 — 세션 시작 시 브리핑

이 파일을 읽으면 아래 형식으로 간단히 브리핑할 것:

```
시스템 상태:
  - 주요 구성 요소 N개 (데몬, 클라우드, 자동화)
  - 마지막 주요 변경: [날짜 + 내용]
  - 현재 진행 중인 작업: [있으면 기재]
```

길게 설명하지 말 것. 3줄 이내.

---

## 설계 철학

### 1. SvelteKit 방식 — 폴더 구조가 곧 아키텍처
"어느 폴더에 넣을까"를 먼저 결정하면 설정이 자동으로 따라온다.

| 폴더 | 역할 |
|------|------|
| `scripts/` (루트) | 일반 유틸 스크립트 |
| `scripts/daemons/` | PID 기반 백그라운드 데몬 |
| `scripts/clouds/` | 클라우드/SSH 원격 서버 연결 |
| `scripts/memory-backup/` | Claude 메모리 자동 백업 |
| `scripts/webExporter/` | 웹 캡쳐/PDF 변환 도구 |

### 2. 하드코딩 금지
- 절대경로, 고정 사용자명, 고정 버전 → `$SELF_DIR`, `$HOME`, 환경변수로
- 키/토큰/비밀번호 → 코드에 절대 포함하지 않고 `env.md`에서 런타임에 읽음

### 3. 소스와 실행 분리
- **소스:** `iCloud/0/scripts/` — 여기서만 수정
- **실행:** `~/bin/` — LaunchAgent가 이쪽을 참조
- `installScripts.sh`가 iCloud → ~/bin 동기화

### 4. 네이밍 컨벤션
- 모든 파일/스크립트명: **camelCase** 필수 (예: `statusBriefing.sh`, `ociIn.sh`)
- 폴더명: 소문자 또는 camelCase (예: `clouds/`, `webExporter/`)

### 5. ~/bin 자동 PATH 등록
- `installScripts.sh`가 `clouds/{svc}/` 포함 모든 서브폴더를 `~/bin/` 하위에 배포
- `.zshrc`가 `~/bin/` 하위 모든 폴더를 PATH에 자동 등록
- 새 폴더 추가 → 배포 + 목록 표시 + PATH 등록이 자동으로 따라옴

---

## 전체 흐름

```
iCloud/0/scripts/          ← 소스 원본 (여기서만 수정)
    ↓  watcherScripts LaunchAgent (파일 변경 감지)
    ↓  installScripts.sh
~/bin/                     ← 실행 복사본

    ↓  watcherGitSync LaunchAgent (5분 주기 + 변경 감지)
    ↓  daemons/gitSync.sh
GitHub (clavier0/clavier-scripts, private)

~/.claude/.../memory/      ← Claude 메모리
    ↓  watcherMemory LaunchAgent (변경 감지, 이벤트드리븐)
    ↓  daemons/syncMemory.sh
scripts/memory-backup/     ← 메모리 백업 (scripts 안에 있으므로 위 흐름으로 GitHub push)
```

---

## 구성 요소

### 데몬 (scripts/daemons/)

| 데몬 | 역할 | 관리 |
|------|------|------|
| `syncObsidian` | Obsidian iCloud → Google Drive rsync | `syncObsidian start\|stop\|status` |
| `syncScriptable` | Scriptable iCloud → Google Drive rsync | `syncScriptable start\|stop\|status` |
| `syncMemory` | Claude 메모리 → memory-backup/ rsync | watcherMemory가 자동 실행 |
| `watcherSync` | syncObsidian/syncScriptable 5분마다 감시/재시작 | LaunchAgent |
| `gitSync` | scripts 변경 → git commit + push | watcherGitSync가 자동 실행 |
| `obsidianTagSync` | Obsidian 태그 → macOS Finder 태그 동기화 | LaunchAgent |
| `workerPdf` | PDF 처리 워커 | LaunchAgent |

**자주 죽는 데몬:** syncObsidian, syncScriptable → statusBriefing이 터미널 시작 시 자동 재시작

### 클라우드 서버 (scripts/clouds/)

| 서비스 | IP/주소 | 용도 | 연결 | 스크립트 |
|--------|---------|------|------|---------|
| OCI | 168.107.63.94 | n8n 자동화 + Cloudflare Tunnel | `ociIn` | `clouds/oci/ociIn.sh` |

**복원:** `git clone clavier0/OCI_hyuk439 && bash setup.sh` (Claude Code 2.1.110 포함)

### LaunchAgents (~/Library/LaunchAgents/)

| Label | 트리거 | 실행 |
|-------|--------|------|
| `com.clavier.watcherScripts` | scripts 폴더 WatchPaths | installScripts |
| `com.clavier.watcherGitSync` | scripts 폴더 WatchPaths + 5분 주기 | gitSync |
| `com.clavier.watcherMemory` | memory 폴더 WatchPaths | syncMemory |
| `com.clavier.watcherSync` | 5분 주기 | watcherSync (데몬 감시) |
| `com.clavier.watcherScreenshots` | Screenshots 폴더 WatchPaths | 스크린샷 처리 |
| `com.clavier.workerPdf` | WatchPaths | pdfToImg 처리 |
| `com.clavier.syncObsidian` | - | syncObsidian |
| `com.clavier.syncScriptable` | - | syncScriptable |
| `com.clavier.obsidian-tag-sync` | - | obsidianTagSync |

### 터미널 시작 시 자동 실행 (~/.zshrc)

```
statusBriefing    데몬 상태 + 연결 가능 서버 체크 + 스크립트 목록
```

**statusBriefing.sh 동적 작동 방식:**
- **데몬 섹션**: `daemons/*.sh`의 `# @group`, `# @type`, `# @label`, `# @pid`, `# @restart` 메타 주석을 읽어 자동 그룹화
- **서버 섹션**: `clouds/*/server.conf` (LABEL/HOST/PORT 변수)를 읽어 자동 목록화
- **스크립트 목록**: `scriptsList.sh`가 서브폴더 자동 감지
- 하드코딩 없음 — 파일 추가/삭제/이름변경 시 브리핑이 자동으로 반영됨

---

## 주요 경로

| 항목 | 경로 |
|------|------|
| 스크립트 소스 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` |
| 실행 바이너리 | `~/bin/` |
| 환경변수/토큰 | `iCloud/0/scripts/env.md` (gitignore됨) |
| Claude 메모리 | `~/.claude/projects/-Users-clavier/memory/` |
| 메모리 백업 | `iCloud/0/scripts/memory-backup/` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.clavier.*` |
| 로그 | `~/Library/Logs/` |

---

## 변경 이력 (주요 아키텍처 변경만)

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-04-15 | statusBriefing: 완전 동적 전환 — 데몬/서버 섹션 모두 파일 메타에서 자동 생성, 하드코딩 제거 |
| 2026-04-15 | 데몬 스크립트 전체에 @group/@type/@label/@pid/@restart 메타 주석 추가 |
| 2026-04-15 | clouds/oci/server.conf 신설 — statusBriefing 동적 서버 목록 드라이버 |
| 2026-04-17 | installScripts: clouds/ 자동 배포 + ~/bin 하위 전체 PATH 자동 등록 |
| 2026-04-17 | scriptsList: 서브폴더 하드코딩 제거, 자동 감지로 전환 |
| 2026-04-17 | OCI_hyuk439 레포 백업 + setup.sh (원클릭 복원), Claude Code 2.1.110 설치 |
| 2026-04-16 | clouds/ 폴더 신설 — 원격 서버 연결 체계화 (ociIn.sh) |
| 2026-04-16 | memory-backup/ + watcherMemory — Claude 메모리 이벤트드리븐 GitHub 백업 |
| 2026-04-14 | obsidianTagSync 데몬 추가 — Obsidian 태그 → macOS Finder 태그 |
| 2026-04-14 | statusBriefing: 죽은 데몬 자동 재시작 기능 추가 |
