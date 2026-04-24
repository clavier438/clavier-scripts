# 작업 현황 — 전체 프로젝트

> 마지막 업데이트: 2026-04-22  
> 세션 재개 시 이 파일 먼저 읽을 것. 각 프로젝트 상세는 하위 PROGRESS.md 참조.

---

## 진행 중인 작업

### 🔄 webExporter — Playwright 웹 캡쳐 도구
- **repo**: `clavier0/web-exporter` (submodule: `webExporter/`)
- **브랜치**: `full-page-capture` (작업 중)
- **상세**: [webExporter/PROGRESS.md](webExporter/PROGRESS.md)

| Fix | 내용 | 상태 |
|-----|------|------|
| Fix 1 | IO 모킹 재도입 — 이미지 로딩 복구 | ✅ 커밋됨 |
| Fix 2 | sticky→static — 모바일/태블릿 레이아웃 | ✅ 커밋됨 |
| Fix 2-b | GSAP ScrollTrigger 리셋 — 데스크탑 scrollytelling | 🔄 **사용자 확인 대기** |
| Fix 3 | 배경 그라디언트 끊김 — 스크롤 스텝 ~300px | ⏳ 대기 |
| 별도 | PIL 65500px 초과 스티칭 실패 (english/tablet) | ⏳ 대기 |

**다음 세션 시작점**: Fix 2-b 데스크탑 PDF 확인 → 커밋 → Fix 3

---

## 완료된 작업 (최근)

### ✅ 2026-04-24 — cal 싱크 추가 + GDrive icloudSync/ 통합

| 항목 | 내용 | 상태 |
|------|------|------|
| syncObsidian.py 범용화 | --src/--gdrive-parent/--gdrive-root/--cache/--lock/--log 인수 추가 | ✅ |
| GDrive 구조 통합 | obsidianSync → icloudSync/obsidianSync/ 자동 이동 (재업로드 없음) | ✅ |
| cal 싱크 추가 | Scriptable data/cal/ → icloudSync/cal/, watcherCal LaunchAgent 신설 | ✅ |

**GDrive 현재 구조:** `icloudSync/obsidianSync/` + `icloudSync/cal/`

---

### ✅ 2026-04-22 — 아키텍처 대정리

| 항목 | 내용 | 상태 |
|------|------|------|
| Mac→Airtable 직접 업로드 | `airtableUpload.sh` + `airtableGeneric.py` — OCI 없이 Mac에서 직접 실행 | ✅ |
| iCloud→GDrive 싱크 데몬 전체 제거 | syncObsidian, syncScriptable, obsidianTagSync, watcherSync 데몬 + LaunchAgent plist 삭제 | ✅ |
| OCI dead code 제거 | myAlgorithm 싱크 + airtable-upload 엔드포인트 + `airtableUpload.py` 삭제 | ✅ |
| OCI `.env` 정리 | MY_ALGO_*, GDRIVE_JOBS_FOLDER, GDRIVE_OBSIDIAN_FOLDER, POLL_INTERVAL 제거 | ✅ |
| GDrive 정리 | obsidianSync, scriptableSync, scriptsSync, airtable/jobs 폴더 삭제 | ✅ |
| iCloud 폴더 정리 | GDrive stay/계약 + stayStudy → iCloud 0/stay/ 이동 | ✅ |

**현재 OCI 역할:** Airtable→GDrive 싱크(웹훅 드리븐)만. 업로드 방향 완전 제거.
**다음 세션 시작점:** `dynamicFilter` Framer 코드 컴포넌트 작업 (code/projects/PROGRESS.md 참조)

---

### ✅ airtable-jobs — GDrive→Airtable 역방향 업로드 파이프라인

| 단계 | 내용 | 상태 |
|------|------|------|
| PROTOCOL.json | Google Drive airtable/jobs/ 루트에 타입 코드 정의 배치 | ✅ |
| airtableGeneric.py v3 | 새 schema.json 포맷(TXT/SEL/LNG/LNK) 파싱, SELF_DIR 기반 상대경로, AIRTABLE_PAT env var 지원 | ✅ |
| airtableUpload.py (OCI) | GDrive 다운로드 + Airtable 업로드 실행 모듈 | ✅ |
| GDrive 폴더 통합 | airtableSync/ + airtable-jobs/ → airtable/sync/ + airtable/jobs/ | ✅ |
| .env 하드코딩 제거 | OCI: SELF_DIR/.env, _load_env() + _require() 패턴 전면 도입 | ✅ |
| POST /airtable-upload | OCI HTTP 엔드포인트 — GDrive 다운로드 + 실행 + 결과 반환 | ✅ |
| 4.0.0_sisoso 업로드 | claude 워크스페이스에 실제 데이터 업로드 완료 (base_id: appVocuq0FLl9GM4U) | ✅ |
| 단일 정보원 | airtable-jobs 전체 실행 이력/결과 집계 레지스트리 | ⏳ 계획됨 |

### ✅ OCI 브리핑 시스템

| 항목 | 내용 | 상태 |
|------|------|------|
| GET /status | 서버 상태 JSON 엔드포인트 (tunnel, webhooks, uptime) | ✅ |
| ociBriefing.sh | OCI 로컬 실행 브리핑 스크립트 (6개 카테고리) | ✅ |
| ociStatus.sh | Mac에서 SSH로 OCI 브리핑 호출 | ✅ |
| dday 서비스 제거 | dday-web.service + dday-tunnel.service 삭제 | ✅ |
| PORT 변경 | 8080 → 8081 (.env로 관리) | ✅ |

### ✅ OCI 서버 백업 — 원클릭 복원 스크립트
- **repo**: `clavier0/OCI_hyuk439` (main 브랜치)
- **서버**: `168.107.63.94` (ubuntu, port 22)

**복원 방법**:
```bash
git clone https://github.com/clavier0/OCI_hyuk439.git
cd OCI_hyuk439
bash setup.sh
```

---

## 완료된 작업 (이력)

| 날짜 | 내용 | repo |
|------|------|------|
| 2026-04-21 | OCI 브리핑 시스템, dday 제거, PORT 8081, /status 엔드포인트 | oci-scripts |
| 2026-04-21 | airtable-jobs 파이프라인 완성 — PROTOCOL.json, airtableUpload.py, /airtable-upload | oci-scripts |
| 2026-04-21 | GDrive airtable/ 폴더 통합, .env 하드코딩 전면 제거 | oci-scripts |
| 2026-04-16 | webExporter submodule 분리, PROGRESS.md 도입 | web-exporter |
| 2026-04-16 | ARCHITECTURE.md 신설, memory 자동 백업 데몬 | clavier-scripts |
| 2026-04-16 | clouds/ 폴더, OCI connectSsh.sh, statusBriefing.sh | clavier-scripts |

---

## 폴더 구조

```
scripts/
├── PROGRESS.md          ← 이 파일 (전체 현황 집계)
├── ARCHITECTURE.md      ← 시스템 설계/구조
├── env.md               ← API 키/토큰 (gitignore)
├── webExporter/         ← submodule (clavier0/web-exporter)
│   └── PROGRESS.md      ← webExporter 상세
├── clouds/              ← 서버 연결 스크립트
└── daemons/             ← LaunchAgent 관리
```
