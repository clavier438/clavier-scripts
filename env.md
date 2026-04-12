# 환경 설정 복구 가이드

> 포맷 후 이 맥 환경을 다시 구성하는 모든 것.  
> **⚠️ 민감한 키/토큰 포함 — 절대 공개 저장소에 올리지 말 것**

---

## 한 줄 요약

```bash
bash ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/0/scripts/setup.sh
```

이걸 실행하면 자동으로 다 됨. 단, **Full Disk Access 권한은 수동**으로 줘야 함 (아래 설명).

---

## 구조

```
iCloud/0/
├── scripts/                  ← 스크립트 소스 (마스터, iCloud에 보관)
│   ├── setup.sh              ← 포맷 후 전체 복구 스크립트
│   ├── install-scripts.sh    ← 스크립트만 ~/bin에 재설치할 때
│   ├── obsidian-gdrive-sync.sh
│   ├── img2web.sh
│   ├── pdf2img.sh
│   ├── rename_ko_to_camel.py
│   └── env.md                ← 이 파일
└── launchagents/             ← LaunchAgent plist 백업
    ├── com.clavier.obsidian-gdrive-sync.plist
    └── com.user.screenshot-import.plist

~/bin/                        ← 로컬 실행 복사본 (LaunchAgent가 여기를 참조)
~/Library/LaunchAgents/       ← 실제 등록된 LaunchAgent
```

> **왜 ~/bin에 복사하나?**  
> macOS LaunchAgent는 iCloud 경로 파일을 직접 실행 못함 (TCC 제한).  
> iCloud = 소스 보관용, ~/bin = 실행용으로 분리.  
> 스크립트 수정 시 `install-scripts.sh` 다시 실행하면 ~/bin 갱신됨.

---

## 포맷 후 복구 순서

### Step 1 — iCloud 동기화 대기
로그인 후 iCloud Drive가 `~/Library/Mobile Documents/` 에 파일 다운로드할 때까지 기다림.  
Finder에서 iCloud/0/scripts/ 폴더 열어서 파일들 다 보이면 OK.

### Step 1.5 — GNU rsync 설치 (setup.sh가 자동 처리)
```bash
brew install rsync fswatch
```
> macOS 내장 openrsync는 iCloud+GDrive 조합에서 mmap 버그 있음. 반드시 Homebrew rsync 사용.

### Step 2 — setup.sh 실행
```bash
bash ~/Library/Mobile\ Documents/com\~apple\~CloudDocs/0/scripts/setup.sh
```
자동으로 처리하는 것:
- Homebrew 설치 확인
- `fswatch`, `rsync` 설치
- 스크립트 `~/bin/`에 복사
- `~/bin` PATH 등록 (`~/.zshrc`)
- LaunchAgent plist 등록 및 로드
- 시스템 설정 창 열어줌

### Step 3 — Full Disk Access 수동 부여 (코드로 못함)
시스템 설정 → 개인 정보 보호 및 보안 → **전체 디스크 접근 권한**  
`+` 버튼 → `Cmd+Shift+G`로 경로 직접 입력:

| 추가할 항목 | 경로 |
|---|---|
| bash | `/bin/bash` |
| rsync | `/usr/bin/rsync` |
| fswatch | `/opt/homebrew/bin/fswatch` |

### Step 4 — 동작 확인
```bash
launchctl list | grep clavier       # exit 0 이면 정상
obsidian-gdrive-sync status         # Running (PID XXXXX) 이면 정상
obsidian-gdrive-sync logs           # 실시간 로그 보기
```

---

## 백그라운드 서비스 목록

| LaunchAgent | 트리거 | 하는 일 |
|---|---|---|
| `com.clavier.obsidian-gdrive-sync` | 로그인 시 자동 시작 | Obsidian iCloud → Google Drive/obsidianSync 실시간 rsync |
| `com.clavier.scriptable-gdrive-sync` | 로그인 시 자동 시작 | Scriptable iCloud → Google Drive/scriptableSync 실시간 rsync |
| `com.user.screenshot-import` | 스크린샷 폴더에 파일 생길 때 | 스크린샷 → Photos 앱 자동 import |

> **rsync**: 반드시 `/opt/homebrew/bin/rsync` (GNU rsync 3.4+) 사용.  
> macOS 내장 openrsync는 iCloud+GDrive 조합에서 mmap 버그 있음.  
> → `brew install rsync` 필요

---

## ~/bin 명령어 목록

| 명령어 | 사용법 |
|---|---|
| `obsidian-gdrive-sync` | `start` / `stop` / `status` / `logs` / `sync` |
| `img2web` | `img2web [-f webp\|jpg\|png] [-q 품질] [-w 너비] 파일...` |
| `pdf2img` | `pdf2img [-f jpg\|png] [-d DPI] 파일...` |
| `rename_ko_to_camel` | `rename_ko_to_camel 파일...` |

---

## 주요 경로

| 항목 | 경로 |
|---|---|
| 스크립트 소스 | `~/Library/Mobile Documents/com~apple~CloudDocs/0/scripts/` |
| Obsidian vault | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/` |
| Google Drive sync 대상 | `~/Library/CloudStorage/GoogleDrive-hyuk439@gmail.com/My Drive/obsidianSync/` |
| sync 로그 | `~/Library/Logs/obsidian-gdrive-sync-daemon.log` |
| sync PID | `~/.local/run/obsidian-gdrive-sync.pid` |

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `launchctl list`에서 exit 126 | `/bin/bash` FDA 없음 | Step 3 다시 확인 |
| `rsync: Operation not permitted` | FDA 적용 전 기록 or FDA 없음 | FDA 주고 `launchctl unload/load` |
| sync가 안 됨 | fswatch 프로세스 죽음 | `obsidian-gdrive-sync restart` |
| `.icloud` 파일 sync 오류 | iCloud가 파일 미다운로드 | Finder에서 해당 폴더 열어 강제 다운로드 후 재시도 |
| 스크립트 수정 후 반영 안 됨 | ~/bin은 복사본 | `install-scripts.sh` 다시 실행 |

---

## 서비스 및 계정 정보

> 최종 업데이트: 2025-11-26

### GitHub
```
USERNAME: clavier0
TOKEN:    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
REPO:     https://github.com/clavier0/OCI_hyuk439.git
```

### OCI (Oracle Cloud) 서버
```
IP:       168.107.63.94
PORT:     22
USER:     ubuntu
```
SSH 접속:
```bash
ssh -i /tmp/oci_key ubuntu@168.107.63.94
```
Private Key (base64):
```
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQy
NTUxOQAAACDowklBrr4jP2VxWMkAUjVqaFCJdbNosD12o/LvraU9KAAAAJg884u/PPOLvw
AAAAtzc2gtZWQyNTUxOQAAACDowklBrr4jP2VxWMkAUjVqaFCJdbNosD12o/LvraU9KAAAA
EAIjpXtcBCejMVvkKQJY2SL6tsmzG705MrN+vQkeEyQr+jCSUGuviM/ZXFYyQBSNWpoUIl
1s2iwPXaj8u+tpT0oAAAAD2h5dWs0MzlAbWFjYm9vawECAwQFBg==
```

OCI 서버 명령어:
```
n8n-url / n8n-restart / n8n-status
oci-backup [메시지] / oci-save / oci-status
oci-auto-start / oci-auto-stop / oci-auto-status / oci-auto-logs
show-commands / show-status
```

### n8n
```
LOCAL PORT: 5678
CLOUDFLARE: https://attendance-solved-accept-helping.trycloudflare.com
            (터널 재시작 시 URL 변경됨)
```

### Airtable
```
API_KEY:    patfvweF0eRBDmeu9.48731860834b84d91e30b361bee312fc0d9c5cad68e4c0981f1ebdfe3b3a63cb
BASE_COUNT: 38
주요 베이스: clientsReal (실제 고객), 내서비스 (내부 관리)
```

### HubSpot CRM
```
STATUS: 연동 완료
최근: 37개 한국 숙박업체 연락처 동기화 (36개 신규 생성)
```

### Claude Desktop MCP 서버
```
CONFIG: ~/Library/Application Support/Claude/claude_desktop_config.json
```
활성화된 MCP: Obsidian, Airtable, HubSpot, Apple Notes, iMessage, Mac Control, Chrome Control, PDF Tools, Figma

---

## 시스템 아키텍처

```
[Mac] Claude Desktop
  ↓ (MCP)
├── Airtable      (리드 데이터)
├── HubSpot       (CRM)
├── Obsidian      (노트)
└── OCI 서버 168.107.63.94
     ├── n8n + Cloudflare Tunnel
     └── 자동 백업 → GitHub
```

---

## 목표
```
월 목표 현금흐름: 3,400,000원
현재 포커스:     리드 생성 및 CRM 관리
타겟 시장:       한국 숙박업체
```
