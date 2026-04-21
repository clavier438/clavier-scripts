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

## 보유 인프라 — 설계 기준

모든 자동화는 아래 인프라 조합으로 구현. 새 기능 설계 시 이 목록에서 먼저 검토.

| 인프라 | 역할 | 특징 |
|--------|------|------|
| **OCI 서버** (`168.107.63.94`) | 항상 켜진 처리 엔진 | 데몬, 웹훅 수신, 스케줄러 |
| **Google Drive API** | 범용 저장소 | OAuth 발급 완료 (env.md 참고) |
| **Cloudflare Workers** | 엣지 트리거/웹훅 라우팅 | 무료 10만req/일 |
| **Scriptable (iOS)** | 폰에서 직접 실행 | iCloud 접근 + 외부 API 호출 |

---

## 전체 흐름

### Mac 자동화
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
scripts/memory-backup/     ← 메모리 백업 → GitHub push
```

### Obsidian 싱크 (Mac 불필요)
```
iPhone Obsidian (iCloud)
    ↓  Scriptable: obsidianGdriveSync.js (Google Drive API 직접 호출)
Google Drive: obsidianSync/          ← Sana AI가 읽음
```
**결정 이유:** Sana AI가 Google Drive만 네이티브 지원. 제3자 서버 없이 본인 OAuth app으로 직접 연동.
Mac 데몬(syncObsidian)은 Mac 켜진 경우 보조 역할로 유지.

### Airtable ↔ Google Drive ↔ Sana (Mac/폰 불필요)

**Airtable → Google Drive (자동, 이벤트드리븐)**
```
Airtable (변경 발생)
    ↓  웹훅 → OCI:8080
    ↓  airtableGdriveSync.py
Google Drive: airtableSync/{base}/{table}.csv   ← Sana AI가 읽음
    +
GitHub: clavier0/airtable-data                  ← 버전 관리 백업 (자동 커밋)
```

**Google Drive → Airtable (수동 트리거, airtable-jobs 워크플로우)**
```
Sana: 콘텐츠 기획 → CSV + schema.json 생성
    ↓  Google Drive: airtable-jobs/{job-name}/
    ↓  수동 트리거 (curl POST → OCI:8080/airtable-upload)
    ↓  OCI: Google Drive에서 파일 다운로드 → airtableGeneric.py 실행
Airtable: 테이블 생성 + 데이터 업로드 완료
```
- `airtable-jobs/PROTOCOL.json` — 타입 코드 정의 (불변, Sana/OCI 공통 참조)
- `schema.json` 타입 코드: `TXT` / `SEL` / `LNG` / `LNK` (언어 독립적 고정 코드)
- `airtableGeneric.py` v3: `__file__` 기준 상대경로 + `AIRTABLE_PAT` env var 우선 지원

**결정 이유:** Sana AI가 항상 최신 Airtable 데이터를 볼 수 있어야 함.
OCI + Google Drive만으로 24/7 운영. Mac/폰 꺼져도 무관.

### Scripts → Google Drive (Scriptable)
```
iCloud/0/scripts/
    ↓  Scriptable: scriptsGdriveSync.js (env.md 제외)
Google Drive: scriptsSync/
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

| 서비스 | IP/주소 | 용도 | 연결 |
|--------|---------|------|------|
| OCI | 168.107.63.94 | Airtable↔GDrive 싱크 서버, Claude Code | `ociIn` |

**OCI 실행 중인 서비스:**
- `airtable-sync` (systemd): Airtable 웹훅 수신 + CSV → GDrive + GitHub 자동 커밋
- 웹훅 엔드포인트: `http://168.107.63.94:8080/webhook/{base_id}`
- 수동 트리거: `http://168.107.63.94:8080/sync-to-airtable/{base_id|all}`

**OCI git 관리:** `~/oci-scripts/` → `clavier0/oci-scripts` (GitHub private)

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

## iCloud/0/ 폴더 구조

```
iCloud/0/
├── code/                  ← 코드 (git 관리 대상)
│   ├── scripts/           ← Mac 자동화 (이 repo) — 미이동 (경로 참조 수정 후 예정)
│   └── projects/          ← 프로젝트성 코드 (배포/서비스)
│       ├── airtable-framer-sync/     Airtable → Framer CMS 동기화 스크립트
│       └── base-template-server-api/ Cloudflare Worker REST API (Airtable 프록시)
├── scripts/               ← 현재 위치 (code/scripts/로 이동 예정)
├── books/                 ← PDF/도서 (pdf_batch_resume.sh 경로 수정 후 이동 예정)
├── life/                  ← 개인 파일 (documents, study, asset, mp3, numbers)
└── sys/                   ← 시스템 (work, works, data, backup, launchagents, passward)
```

### 미완료: scripts → code/scripts 이동 (+ 상대경로 전환)

**왜 옮기나**: 모든 코드를 `code/` 아래 한 곳에 모아 구조를 단순하게 유지.
`scripts`와 `projects`를 형제 폴더로 두면 "코드 = code/ 안에 다 있다"는 원칙이 성립됨.

**왜 상대경로로 바꾸나**: 현재 7개 파일이 `0/scripts` 절대경로를 하드코딩 중.
폴더를 옮기면 경로가 즉시 깨짐. 상대경로(`$SELF_DIR`, `$(dirname "$0")` 기반)로 바꾸면
폴더를 어디로 옮기든 스크립트가 자기 위치를 기준으로 동작 → 이동/복원/포맷 후 복구에 안전.

**이것이 설계 철학 "2. 하드코딩 금지"의 완성**: 현재 키/토큰은 env.md로 분리됐지만
경로 하드코딩은 아직 남아있는 상태. 이 작업이 완료되면 스크립트 전체가 경로에 독립적.

**수정 필요 파일 7개**:
- LaunchAgents plist 3개: `watcherGitSync`, `watcherScripts`, `workerPdf`
  → plist는 상대경로 불가 → 래퍼 스크립트(`$HOME` 기반)로 간접 참조
- 스크립트 4개: `syncMemory.sh`, `scriptsGdriveSync.js`, `ociIn.sh`, `scriptsList.sh`
  → `SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` 패턴으로 전환
- `books` 폴더: `pdf_batch_resume.sh`(절대경로), `runSafariTabsExport.sh`($HOME 기반) 수정 후 이동

**완료 후 기대 상태**:
```
iCloud/0/code/
├── scripts/    ← 기존 scripts (상대경로 전환 완료)
└── projects/   ← airtable-framer-sync, base-template-server-api
```

## 주요 경로

| 항목 | 경로 |
|------|------|
| 스크립트 소스 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` |
| 프로젝트 코드 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/` |
| 실행 바이너리 | `~/bin/` |
| 환경변수/토큰 | `iCloud/0/scripts/env.md` (gitignore됨) |
| Claude 메모리 | `~/.claude/projects/-Users-clavier/memory/` |
| 메모리 백업 | `iCloud/0/scripts/memory-backup/` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.clavier.*` |
| 로그 | `~/Library/Logs/` |
| OCI 스크립트 | `ubuntu@168.107.63.94:~/oci-scripts/` |
| Airtable 백업 | `ubuntu@168.107.63.94:~/airtable-data/` → GitHub |

## GitHub Repos

| Repo | 내용 | 관리 위치 |
|------|------|-----------|
| `clavier0/clavier-scripts` | Mac 자동화 전체 | Mac `iCloud/0/scripts/` |
| `clavier0/oci-scripts` | OCI 서버 스크립트 | OCI `~/oci-scripts/` |
| `clavier0/airtable-data` | Airtable 전체 CSV 백업 (자동) | OCI `~/airtable-data/` |

---

## 변경 이력 (주요 아키텍처 변경만)

| 날짜 | 변경 내용 |
|------|-----------|
| 2026-04-21 | airtable-jobs 워크플로우 신설 — GDrive→Airtable 역방향, PROTOCOL.json 타입 코드 고정, airtableGeneric.py v3 |
| 2026-04-21 | iCloud/0/ 폴더 구조 정리 — code/projects/, life/, sys/ 신설. scripts는 경로 수정 후 이동 예정 |
| 2026-04-21 | code/projects/ 신설 — airtable-framer-sync, base-template-server-api 이동 |
| 2026-04-21 | Airtable 4.0.0_branch → Framer CMS 동기화 완료 (5개 컬렉션, 205개 레코드) |
| 2026-04-21 | Cloudflare Worker base-template-server-api 배포 — Airtable REST API 프록시 |
| 2026-04-18 | syncObsidian: 전체 rsync → 변경 파일 단건 처리 (Sana AI 동기화 시차 개선) |
| 2026-04-18 | obsidianGdriveSync.js + scriptsGdriveSync.js: Scriptable에서 Google Drive API 직접 호출 (맥 불필요) |
| 2026-04-18 | Google OAuth 개인 앱 발급 — 범용 Google API credentials (env.md에 저장) |
| 2026-04-18 | OCI에 airtableGdriveSync.py 배포 — Airtable↔GDrive CSV 싱크, 웹훅 이벤트드리븐 |
| 2026-04-18 | airtable-data GitHub repo — Airtable 전체 CSV 자동 커밋/버전관리 백업 |
| 2026-04-18 | oci-scripts GitHub repo — OCI 서버 코드 git 관리 시작 |
| 2026-04-18 | n8n 종료 — 직접 Python 서버로 대체 (메모리 절약 + 코드 완전 제어) |
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
