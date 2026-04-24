---
name: platform-workers 구조 및 운영 현황
description: Cloudflare Workers 모음 — Framer/Airtable 연결 인프라. 새 프로젝트 연결 시 반드시 참조.
type: project
---

## 위치

로컬: `~/Library/Mobile Documents/.../code/projects/platform-workers/`
GitHub: https://github.com/clavier0/platform-workers (private)

## 구조

```
platform-workers/
├── framer-sync/      ← 범용 CF Worker (TypeScript)
│   └── wrangler.toml (sisoso + hotelAgencyOps 환경 포함)
├── sisoso-api/       ← 레거시 CF Worker (JS, 단순 SCHEMA)
├── PROGRESS.md       ← 세션 간 인계 파일 (다음 할 일 목록 있음)
└── RUNBOOK.md        ← 운영 절차서
```

## 배포된 Workers

| CF Worker 이름 | 프로젝트 | wrangler env |
|----------------|----------|-------------|
| framer-sync-sisoso | sisoso Framer | `--env sisoso` |
| hotel-agency-ops-api | 호텔 에이전시 문서 API | `--env hotelAgencyOps` |

## Framer 연결 두 경로

- **경로 1 (CMS)**: Airtable 변경 → /webhook → Framer ManagedCollection 자동 싱크
- **경로 2 (API)**: Framer 코드 컴포넌트 → GET /:table → Airtable 실시간 조회

두 경로 모두 `framer-sync` 하나의 Worker가 처리. /configure 시 framerProjectUrl 포함 여부로 구분.

## 새 프로젝트 연결

"[프로젝트명] Worker 만들어줘" → RUNBOOK.md 참조해서 진행.
필요한 정보: Airtable 베이스 ID + PAT 토큰 (env.md에 있음).

## 다음 해야 할 일

PROGRESS.md에 상세 목록 있음. 주요 미완료:
- [ ] framer-sync/ npm install + 실제 배포 테스트
- [ ] clavier-scripts tools/ 폴더 구조화 (installScripts.sh 연동 필요)
- [ ] hotel-agency-ops Framer CMS 연동 완성
- [ ] system_registry Airtable 테이블 생성

**Why:** 이전에 Workers가 framer-sync-worker(GitHub)와 로컬에 분산되어 있었음. 2026-04-24 platform-workers로 통합.
**How to apply:** CF Worker 관련 작업은 platform-workers repo에서. framer-sync-worker repo는 deprecated.
