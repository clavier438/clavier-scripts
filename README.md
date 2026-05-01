# iCloud/0 스크립트 컬렉션

> **포맷 후 복구 한 줄 요약** (2026-05-01 갱신)
> ```bash
> bash ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/0/scripts/setup.sh
> doppler login                                                # 시크릿 복구 (브라우저 인증)
> framer push                                                  # framer-sync 로컬 운영 가동 검증
> ```
> setup.sh 가 node·jq·doppler·framer·framer-sync npm install 까지 자동. DECISIONS 2026-05-01.

**framer-sync 일상 운영 = `framer` 한 단어** (2026-05-01~):
- `framer push` — Layer 1+2 한방 (Airtable → SQLite → Framer ManagedCollection)
- `framer status / rows / sql / server / deploy` — 전체 명령은 `framer help`
- canonical: `tools/framer.mjs`, 실행: `~/bin/framer` symlink
- Cloudflare 가 죽어도 Mac 한 줄로 운영 지속 (DR 5분)

**시크릿 단일 진실 소스 = Doppler** (project: `clavier`, config: `prd`) — 2026-04-28~.
- 사용: `doppler run -- <명령>` 으로 환경변수 자동 주입
- 관리: `clavier-config list/get/set/delete` (Doppler + iCloud 미러 자동 동기화)
- iCloud `clavier.env` 는 **백업 미러** (자동 생성, 직접 편집 금지)
- 카탈로그·복구 절차: `env.md`

**시스템 일관성 자동 검증 (2026-04-28~)** — Defense in Depth 3 Layer:
- `doc-coverage <개념>` 또는 `doc-coverage --recent` — 12개 표준 문서 일관성 검사
- clavier-hq `hooks/post-commit` 자동 발동 — DECISIONS.md commit 시 즉시 검증
- Notion Architecture Archive — DECISIONS/CONCEPTS 자동 미러 (overnight-runner 매일 03:00)

---

## 디렉토리 구조

```
iCloud/0/
├── scripts/                        ← 스크립트 소스 (마스터, 여기서 수정)
│   ├── setup.sh                    ← 포맷 후 전체 복구 스크립트 (이것만 실행)
│   ├── install-scripts.sh          ← 스크립트만 ~/bin 갱신할 때
│   ├── restore_quick_actions.sh    ← Quick Action 워크플로 복구
│   │
│   ├── obsidian-gdrive-sync.sh     ← Obsidian sync 데몬
│   ├── scriptable-gdrive-sync.sh   ← Scriptable sync 데몬
│   ├── sync-watchdog.sh            ← 데몬 감시/자동재시작 (1시간 주기)
│   ├── status-briefing.sh          ← 터미널 시작시 서비스 상태 출력
│   │
│   ├── img2web.sh                  ← 이미지 웹용 변환 (webp/jpg/png)
│   ├── pdf2img.sh                  ← PDF → 이미지 (ImageMagick)
│   ├── pdf_to_jpeg.sh              ← PDF → JPEG (Quick Action용, macOS Quartz)
│   ├── pdf_batch_resume.sh         ← PDF 일괄 내보내기 (재개 가능)
│   ├── webPdfExporter.sh           ← 웹페이지 → PDF 내보내기
│   ├── run_safari_tabs_export.sh   ← Safari 탭 목록 일괄 PDF 내보내기
│   │
│   ├── rename_ko_to_camel.py       ← 한글 파일명 → camelCase 영문 변환
│   ├── airtable_generic.py         ← Airtable API 유틸리티
│   │
│   ├── README.md                   ← 이 파일
│   └── env.md                      ← 계정/토큰 정보 (민감 — 비공개)
│
└── launchagents/                   ← LaunchAgent plist 백업본
    ├── com.clavier.obsidian-gdrive-sync.plist
    ├── com.clavier.scriptable-gdrive-sync.plist
    ├── com.clavier.sync-watchdog.plist
    └── com.user.screenshot-import.plist

~/bin/                              ← 실행 복사본 (LaunchAgent가 여기 참조)
~/Library/LaunchAgents/             ← 실제 등록된 LaunchAgent
```

> **왜 ~/bin에 복사하나?**
> macOS LaunchAgent는 iCloud 경로 파일 직접 실행 불가 (TCC 제한).
> iCloud = 소스 보관, ~/bin = 실행용으로 분리.
> 스크립트 수정 후 `install-scripts.sh` 실행하면 ~/bin 갱신됨.

---

## 포맷 후 복구 순서

### 1단계 — iCloud 동기화 대기
로그인 후 Finder에서 `iCloud/0/scripts/` 폴더 열어서 파일이 다 보일 때까지 대기.

### 2단계 — setup.sh 실행
```bash
bash ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/0/scripts/setup.sh
```

자동으로 처리:
- Homebrew 확인/설치
- 패키지 설치: `fswatch` `rsync` `webp` `imagemagick` `ghostscript`
- 모든 스크립트 `~/bin/` 복사 + 실행 권한 부여
- `~/bin` PATH 등록 (`~/.zshrc`)
- 터미널 시작시 서비스 상태 브리핑 등록
- LaunchAgent plist 전체 등록 및 시작
- 시스템 설정 창 자동 열기

### 3단계 — 전체 디스크 접근 권한 수동 부여 (코드로 못함)

시스템 설정 → 개인 정보 보호 및 보안 → **전체 디스크 접근 권한**
`+` 버튼 → `Cmd+Shift+G`로 경로 직접 입력:

| 추가 항목 | 경로 |
|---|---|
| bash | `/bin/bash` |
| rsync | `/opt/homebrew/bin/rsync` |
| fswatch | `/opt/homebrew/bin/fswatch` |

### 4단계 — 동작 확인
```bash
launchctl list | grep clavier        # 등록된 서비스 목록
obsidian-gdrive-sync status          # Running (PID XXXXX) 이면 정상
scriptable-gdrive-sync status
cat ~/Library/Logs/sync-watchdog.log # watchdog 실행 기록
```

---

## 백그라운드 서비스 (LaunchAgent)

| LaunchAgent | 트리거 | 역할 |
|---|---|---|
| `com.clavier.obsidian-gdrive-sync` | 로그인 시 자동 시작 | Obsidian iCloud → Google Drive/obsidianSync 실시간 rsync |
| `com.clavier.scriptable-gdrive-sync` | 로그인 시 자동 시작 | Scriptable iCloud → Google Drive/scriptableSync 실시간 rsync |
| `com.clavier.sync-watchdog` | 로그인 시 + 1시간마다 | 위 두 데몬 감시, 꺼져있으면 자동 재시작 |
| `com.user.screenshot-import` | 스크린샷 폴더 변경 감지 | 스크린샷 → Photos 앱 자동 import |

### sync 데몬 동작 방식
```
[시작] 전체 rsync 1회 실행
  ↓
[상시] fswatch로 소스 폴더 감시
  ↓ 파일 변경 감지
[즉시] rsync 실행 (변경분 반영)
```

### watchdog 동작 방식
```
[1시간마다] PID 파일 확인
  → 프로세스 살아있음: "정상" 로그만 기록
  → 프로세스 없음: start 명령 실행 후 로그 기록
```

---

## ~/bin 명령어 목록

### sync 데몬 관리
```bash
obsidian-gdrive-sync start|stop|restart|status|sync|logs
scriptable-gdrive-sync start|stop|restart|status|sync|logs
status-briefing                    # 전체 서비스 상태 한눈에 보기
```

### 이미지/PDF 변환
```bash
# 이미지 → 웹용 (webp 기본)
img2web [-f webp|jpg|png] [-q 품질] [-w 최대너비px] [-d 출력폴더] 파일...
img2web photo.jpg
img2web -f webp -q 75 -w 1280 ./*

# PDF → 이미지 (ImageMagick, 다중 페이지 지원)
pdf2img [-f jpg|png|tiff|webp] [-d DPI] [-o 출력폴더] 파일...
pdf2img report.pdf
pdf2img -f png -d 300 -o ./output ./*.pdf

# 웹페이지 → PDF
webPdfExporter URL [-o 출력폴더] [-m 최대시도] [-s 대기초]
webPdfExporter https://example.com -o ~/Downloads

# PDF 일괄 내보내기 (url 목록 파일 기반, 재개 가능)
pdf_batch_resume                   # pdf_export_urls.txt 읽어서 실행
```

### 파일명 변환
```bash
# 한글 파일명 → camelCase 영문 (미리보기)
rename_ko_to_camel
# 실제 적용
rename_ko_to_camel --run
```

### Airtable
```bash
airtable_generic                   # Airtable API 유틸리티 (env.md 토큰 필요)
```

---

## 스크립트 수정 흐름

```
iCloud/0/scripts/XXX.sh 수정
        ↓
install-scripts.sh 실행   (또는 setup.sh 재실행)
        ↓
~/bin/XXX 갱신됨
```

LaunchAgent에 등록된 데몬 스크립트는 수정 후 `install-scripts.sh` + 데몬 restart 필요:
```bash
install-scripts.sh
obsidian-gdrive-sync restart
scriptable-gdrive-sync restart
```

---

## 로그 파일 위치

| 서비스 | 로그 |
|---|---|
| obsidian sync 데몬 | `~/Library/Logs/obsidian-gdrive-sync-daemon.log` |
| scriptable sync 데몬 | `~/Library/Logs/scriptable-gdrive-sync-daemon.log` |
| sync watchdog | `~/Library/Logs/sync-watchdog.log` |
| obsidian LaunchAgent stdout | `~/Library/Logs/obsidian-gdrive-sync.log` |
| scriptable LaunchAgent stdout | `~/Library/Logs/scriptable-gdrive-sync.log` |

---

## 주요 경로

| 항목 | 경로 |
|---|---|
| 스크립트 소스 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` |
| platform-workers (canonical, 2026-04-28) | `~/Library/Mobile Documents/com~apple~CloudDocs/0/code/projects/platform-workers/` (단일 클론 — DECISIONS.md "platform-workers canonical 클론 = iCloud 경로" 참조) |
| Obsidian vault | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/` |
| Scriptable | `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/` |
| Google Drive | `~/Library/CloudStorage/GoogleDrive-hyuk439@gmail.com/My Drive/` |
| Obsidian sync 대상 | `…/My Drive/obsidianSync/` |
| Scriptable sync 대상 | `…/My Drive/scriptableSync/` |
| PID 파일 | `~/.local/run/*.pid` |

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `launchctl list`에서 exit 126 | `/bin/bash` FDA 없음 | 3단계 FDA 설정 재확인 |
| `rsync: Operation not permitted` | FDA 미적용 | FDA 주고 `launchctl unload/load` |
| sync가 안 됨 | fswatch 프로세스 죽음 | `obsidian-gdrive-sync restart` |
| watchdog이 재시작 안 함 | `~/bin/sync-watchdog` 없음 | `install-scripts.sh` 실행 |
| `.icloud` 파일 오류 | iCloud 미다운로드 | Finder에서 해당 폴더 열어 강제 다운로드 후 재시도 |
| 스크립트 수정 후 반영 안 됨 | ~/bin은 복사본 | `install-scripts.sh` 실행 |
| `cwebp: command not found` | webp 미설치 | `brew install webp` |
| `convert: command not found` | ImageMagick 미설치 | `brew install imagemagick ghostscript` |

---

## 패키지 의존성

| 패키지 | 용도 | 설치 |
|---|---|---|
| `rsync` (GNU) | sync 데몬 | `brew install rsync` |
| `fswatch` | 파일 변경 감지 | `brew install fswatch` |
| `webp` | img2web WebP 변환 (`cwebp`) | `brew install webp` |
| `imagemagick` | pdf2img PDF 변환 (`convert`) | `brew install imagemagick` |
| `ghostscript` | PDF 렌더링 (ImageMagick 의존) | `brew install ghostscript` |

> **rsync 주의**: macOS 내장 openrsync는 iCloud+GDrive 조합에서 mmap 버그 있음.
> 반드시 `brew install rsync` (GNU rsync 3.4+) 사용.

## 워커 데이터 저장소 (2026-04-28)

Cloudflare Workers의 상태는 **D1을 단일 진실 소스**로 운영. KV는 바이너리 캐시 외 사용 안 함 (계정 단위 일일 한도 1000회 → 다중 워커 동시 마비 위험).

framer-sync는 D1에 4 테이블 보유: `worker_state`, `collection_items`, `collection_fields`, **`airtable_cache`** (data:{table} REST API 캐시 — 2026-04-28 airtable_cache 도입으로 KV 이전). **webp-cache KV→R2 이전 완료 (2026-04-30)**: `webp-cache:{id}` 바이너리는 R2 버킷(`framer-sync-webp-cache`)으로 완전 이전. KV 바이너리 write 없음. health-check-worker는 KV 미사용(Airtable system_registry SSOT).

**framer-sync / control-tower 구조 점검 (2026-04-30)**: D1 SSOT 마이그레이션 직후 SOLID 감사 완료. 주요 발견: `syncCollectionNative ↔ syncCollectionFromD1` 중복(높음), KV 사망 파라미터·모놀리식 라우터(중간). 시정 4개 OVERNIGHT_QUEUE.md 등록. 세부 내용: clavier-hq/DECISIONS.md 2026-04-30.

framer-sync는 외부 Framer 인터페이스를 동결 운영 — **프레이머가 변화를 알 수 없게** `addFields`/`createCollection` 등 스키마 변경 RPC 호출 금지, `getFields()` read-only만 사용. 새 Airtable 필드 시 Framer 슬롯 없으면 graceful skip + 경고 (clavier-hq DECISIONS 2026-04-28 참조).

`webExporter/webSiteExporter.py` 의 `webSiteExporter discover_pages` 함수는 인덱스 페이지네이션 1~3p × detail 3개 모델로 사이트 백업 누락을 줄임(2026-04-28).
