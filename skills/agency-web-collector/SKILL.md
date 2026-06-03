---
name: agency-web-collector
description: 디자인/브랜딩 에이전시 이름을 받아 포트폴리오 전체를 수집하고, 각 클라이언트 공식 웹사이트 URL을 검색한 뒤, Desktop에 CSV로 저장하고 Airtable design 베이스 webDesignModel 테이블에 중복 없이 추가하여 tag 필드에 에이전시 slug로 태깅하는 스킬. "baton 포트폴리오 다 긁어줘", "에이전시 클라이언트 URL 수집", "스튜디오 작업물 에어테이블에 넣어", "OO 에이전시 웹사이트 레퍼런스 정리", "에이전시 긁어줘", "클라이언트 사이트 다 모아줘" 같은 말이 나오면 반드시 이 스킬을 사용할 것.
---

## 목표

에이전시 1개의 전체 클라이언트 포트폴리오 수집 → URL 검색 → CSV 저장 → Airtable 추가 + 태깅을 한 번에 처리한다.

---

## Step 1: 에이전시 slug 확정

사용자 발화에서 에이전시명을 추출해 slug로 변환한다.
- "플러스엑스" → `plus-x`, "바톤" → `baton`, "propaganda" → `propaganda`
- slug는 Airtable tag 값 + CSV 파일명에 사용된다

---

## Step 2: 포트폴리오 수집 (WebSearch + WebFetch)

우선순위 순으로 시도한다:

1. **공식 사이트 직접 fetch** — `/work`, `/projects`, `/portfolio` 경로 시도
2. **검색** — `"{에이전시명} 포트폴리오"`, `"{에이전시명} clients"`, `"site:behance.net {에이전시명}"`
3. **언론/인터뷰** — 월간디자인·디자인정글·브런치 기사에서 클라이언트 목록 추출

JS 렌더링으로 직접 fetch 불가 시: 검색 + 기사 조합으로 최대한 수집. 완전하지 않으면 사용자에게 고지하되 수집된 것은 모두 처리한다.

수집 결과 형식:
```json
[{"project": "클라이언트명", "url": "https://..." }]
```

---

## Step 3: URL 검색 (url=null인 항목)

- `"{클라이언트명} 공식 사이트"` 또는 `"{클라이언트명} official website"` 검색
- 못 찾으면 null 유지 — 추측으로 채우지 않는다

---

## Step 4: Airtable 중복 체크

**Airtable 정보:**
- baseId: `app9b7X9Tn2SXGuMW`
- tableId: `tblP3gahgZd4ro3i7` (webDesignModel)
- `이름` 필드 ID: `fldLspoCxaIf47Jm2`

기존 `이름` 전체를 조회해 대소문자 무시 비교. 중복 항목은 스킵 (업데이트 X).

---

## Step 5: CSV 저장

`~/Desktop/{slug}-clients-live.csv` 생성 (UTF-8, LF):
```csv
project,live_url
클라이언트명,https://...
```
URL 있는 항목만 포함.

---

## Step 6: Airtable 삽입

신규 항목(중복 제외)을 50개씩 배치로 추가한다.

**필드 매핑:**
| 필드 | ID | 값 |
|------|----|----|
| 이름 | `fldLspoCxaIf47Jm2` | project명 |
| 공식 웹사이트 | `fldGZE1lZ8IlKyfX4` | live_url (있을 때만) |
| tag | `fldhY5dgvJ84WFzXx` | `[slug]` |
| url | `fldHu1FEkviN650BP` | 포트폴리오 레퍼런스 URL (있을 때만) |

`typecast: true` 필수 (tag 옵션 자동 생성).

---

## Step 7: 결과 보고

```
✅ {에이전시} 완료
   신규 추가: {N}개 | 중복 스킵: {M}개 | URL 미발견: {K}개
   CSV: ~/Desktop/{slug}-clients-live.csv
```

---

## 주의사항

- JS 렌더링 사이트: 직접 fetch 대신 검색 기반으로 전환
- 클라이언트명 원본 표기 유지 (대소문자 그대로)
- 빈 URL 허용 — 빈 문자열로 채우지 않는다
