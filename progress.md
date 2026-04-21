# 작업 현황 — 전체 프로젝트

> 마지막 업데이트: 2026-04-21  
> 세션 재개 시 이 파일 먼저 읽을 것. 각 프로젝트 상세는 하위 PROGRESS.md 참조.

---

## 진행 중인 작업

### 🔄 airtable-jobs — GDrive→Airtable 역방향 업로드 파이프라인

| 단계 | 내용 | 상태 |
|------|------|------|
| PROTOCOL.json | Google Drive airtable-jobs/ 루트에 타입 코드 정의 배치 | ✅ |
| airtableGeneric.py v3 | 새 schema.json 포맷(TXT/SEL/LNG/LNK) 파싱, SELF_DIR 기반 상대경로, AIRTABLE_PAT env var 지원 | ✅ |
| airtable_generic_readme.md | v3 포맷 + Sana 규격 문서 갱신 | ✅ |
| ARCHITECTURE.md | GDrive→Airtable 역방향 흐름 추가 | ✅ |
| OCI 서버 엔드포인트 | POST /airtable-upload — GDrive 다운로드 + 실행 + 결과 반환 | ⏳ 다음 |
| 단일 정보원 | airtable-jobs 전체 실행 이력/결과 집계 레지스트리 | ⏳ 계획됨 |

**다음 세션 시작점**: OCI에 `/airtable-upload` HTTP 엔드포인트 추가 (oci-scripts repo)

---

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

### ✅ OCI 서버 백업 — 원클릭 복원 스크립트 (완료)
- **repo**: `clavier0/OCI_hyuk439` (main 브랜치)
- **서버**: `168.107.63.94` (ubuntu, port 22)

| 항목 | 상태 |
|------|------|
| 서버 현재 상태 파악 | ✅ |
| clouds/ 폴더 + connectSsh.sh | ✅ |
| Claude Code 2.1.110 설치 | ✅ |
| OCI_hyuk439 repo에 현재 파일 백업 | ✅ |
| setup.sh 작성 (원클릭 복원) | ✅ |
| GitHub push (main 브랜치) | ✅ |

**복원 방법**:
```bash
git clone https://github.com/clavier0/OCI_hyuk439.git
cd OCI_hyuk439
bash setup.sh
```

---

## 완료된 작업 (최근)

| 날짜 | 내용 | repo |
|------|------|------|
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
