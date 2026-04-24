---
name: 에코시스템 아키텍처 인사이트
description: Framer/Airtable/Cloudflare/OCI/Google 인프라 조합 패턴 — Claude가 먼저 제안하기 위한 굵직한 아이디어 저장소
type: project
originSessionId: df26d353-5969-437e-9d93-ff52e2980267
---

> 이 파일은 "이렇게도 할 수 있다"를 Claude가 먼저 꺼내기 위한 파일.
> 새 패턴 발견 시 즉시 추가. 사용자가 묻기 전에 적극적으로 제안할 것.

---

## 핵심 스택 구조

```
Framer (UI/CMS 프론트엔드)
  ↕ Cloudflare Workers API
Airtable (데이터 저장 + 관계 정의)
  ↕ OCI 서버 (웹훅 수신, 배치 처리, 데몬)
Google Cloud (Drive, Calendar, Sheets, Functions)
Sana AI / Google AI Studio (AI 레이어)
```

---

## Worker = Airtable 계산 레이어 ← 적극 제안할 것

**핵심 인사이트**: Airtable의 formula/rollup/lookup 필드는 API로 생성 불가 + UI에서만 설정 가능. 하지만 Worker가 이 역할을 전부 흡수할 수 있다.

| Airtable 기능 | Worker 대체 방법 |
|---|---|
| `formula: RECORD_ID()` | `out.id = record.id` (flattenRecord에서 이미 처리) |
| `rollup: SUM(values)` | linked records fetch 후 `reduce()` |
| `lookup: {linkedField}` | 두 번째 fetch로 expand |
| `formula: IF(...)` | JS 조건문으로 응답 시 계산 |
| View 정렬/필터 (API 변경 불가) | Worker에서 `sort()` / `filter()` |
| 전문검색 (filterByFormula 한계) | Worker에서 fuzzy/includes 검색 |

**제안 트리거**: Airtable 필드 설계 얘기가 나올 때, formula/rollup/lookup 언급 시, "이 필드를 어떻게 만들지"가 나올 때 → "Worker에서 처리하는 게 더 유연합니다" 먼저 꺼낼 것.

---

## Airtable = 순수 저장소, Worker = ORM + API 서버

이 패턴의 철학:
- Airtable: 데이터 저장 + 테이블 관계 정의만
- Worker: 계산, 변환, 인증, 캐싱, 조인, 응답 포맷 전부
- Framer: Worker API만 바라봄 (Airtable 직접 연결 불필요)

장점: Airtable 구조 바꿔도 Worker만 수정하면 Framer는 무영향.

---

## Cloudflare Workers 활용 패턴

- **KV 캐싱**: Airtable rate limit(초당 5req) 우회 — 자주 쓰는 데이터를 KV에 저장, TTL 설정
- **크로스 베이스 조인**: 베이스 여러 개를 Worker에서 병렬 fetch 후 merge
- **인증 레이어**: Airtable엔 per-user 권한 없음 → Worker에서 API key / JWT 검증
- **webhook 수신 endpoint**: OCI/n8n 없이도 트리거 수신 가능
- **응답 포맷 변환**: Framer CMS 포맷, RSS, sitemap.xml 등 다양한 포맷으로 변환

---

## Framer + Airtable + Worker 조합

- Framer CMS Collection → Worker API에서 데이터 fetch
- framer-sync worker: Airtable 변경 → Framer CMS 자동 동기화 (기존 framer-sync-sisoso 패턴)
- stableId 필드가 핵심: Framer CMS item ID와 Airtable stableId를 매핑하면 안정적인 upsert 가능

---

## OCI 활용 패턴

- Airtable webhook → OCI 수신 → 처리 후 GDrive 저장 (기존 airtableGdriveSync.py)
- 장기 실행 배치, 데몬, 스케줄러는 OCI
- Workers는 트리거/라우팅, OCI는 무거운 처리로 역할 분리

---

## Google 무료 인프라 활용 가능 영역

- **Cloud Functions**: OCI 없이 서버리스 배치 실행 (이미 OAuth 발급됨 → 바로 배포 가능)
- **Google Sheets**: 경량 DB / 대시보드 데이터 소스 (Airtable 대용으로 비용 없음)
- **Apps Script**: 트리거 기반 자동화, Gmail/Calendar 연동 (이미 cal_history2 운영 중)
- **Google AI Studio**: Gemini API 무료 티어 — Sana AI 대안 또는 보조

---

## Sana AI 연동 가능 지점

- Airtable 데이터 → Worker → Sana AI 컨텍스트 주입
- 문서/태그 구조가 Sana knowledge base 포맷과 유사 → 직접 연동 검토 가능
