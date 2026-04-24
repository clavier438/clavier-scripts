---
name: hotelAgency_ops 에어테이블 베이스 + 워커
description: 호텔 에이전시 운영 문서/태그 베이스 — Notion에서 마이그레이션, Worker 배포 완료, Framer 연동 대기 중
type: project
originSessionId: df26d353-5969-437e-9d93-ff52e2980267
---
## Airtable 베이스

- 베이스명: `hotelAgency_ops`
- 베이스 ID: `appEElKxB3dSkXFsC`
- 워크스페이스: 클로드 (`wsp9s9TITA2bUxIdq`)
- 소스: Notion "호텔웹사이트 에이전시 > 운영 > 문서들" 데이터베이스에서 마이그레이션

### 테이블

| 테이블 | ID | 필드 |
|---|---|---|
| docs | `tbloJW1QcmezQoeWI` | name, labelKr, slug, group(singleSelect), whenToUse, notes, body(richText), order, tags(multipleRecordLinks) |
| tags | `tblSihmSJM1qWgL0p` | name, labelKr, order, docs(multipleRecordLinks) |

- docs: 14개 레코드 (Notion 원본 마크다운 그대로 body에 저장)
- tags: 5개 레코드 (전략, 미팅, 상시, 제안, 계약)

### 생성 스크립트 위치

- `/tmp/createHotelAgencyOps.py` — 베이스+테이블 생성, 레코드 삽입
- `/tmp/updateBodyRichText.py` — 전체 docs body 필드를 Notion 원본 마크다운으로 일괄 PATCH

## Cloudflare Worker

- Worker 이름: `hotel-agency-ops-api`
- 소스: `/tmp/hotel-agency-ops-api/src/index.js`
- 패턴: base-template-server-api와 동일 (SCHEMA → transformField → flattenRecord → fetchRecords)
- env var: `AIRTABLE_BASE_ID = "appEElKxB3dSkXFsC"` (wrangler.toml)
- secret: `AIRTABLE_API_KEY` (wrangler secret으로 배포)

### 라우트

```
GET /docs          → 전체 문서 목록 (order 정렬)
GET /docs/:id      → 단일 문서
GET /docs?group=X  → 그룹 필터
GET /tags          → 전체 태그 목록
GET /tags/:id      → 단일 태그
```

## 미완료 항목

- **Framer 연동**: 사용자가 Framer 프로젝트명 알려주면 framer-sync 워커 생성 예정 (framer-sync-sisoso 패턴 따를 것)
- **실패 베이스 수동 삭제**: Airtable UI에서 `appHkxD27PuyUc8OK`, `appLdRinOeSPSLF7N` 직접 삭제 필요

**Why:** 컨텍스트 리셋 후에도 이 베이스 작업으로 돌아올 때 다시 처음부터 파악하지 않도록.
**How to apply:** Framer 프로젝트명 받으면 바로 framer-sync 워커 작성 시작. 베이스 구조는 위 테이블 참조.
