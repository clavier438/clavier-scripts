# Airtable PAT 작업 가능/불가 — Claude 작업 컨텍스트

> 이 파일은 UserPromptSubmit hook 으로 자동 주입됨.
> 에어테이블 관련 작업 시작 전 자동으로 Claude 컨텍스트에 들어옴.
> 마지막 갱신: 2026-05-05

---

## 한 줄

**Doppler `AIRTABLE_PAT` (scope: `schema.bases:write` + `data.records:read/write`) 으로 외부 Node 에서 거의 모든 자동화 가능. 단 *삭제* 와 *in-base UI* 는 web UI 에서.**

---

## 가능 ✅ (PAT + Web/Metadata API)

### 데이터 (records)
- record CRUD (POST/PATCH/DELETE `/v0/{baseId}/{tableId}`)
- 일괄 create/patch (records 10개씩 batch)
- filterByFormula 로 특정 record 검색
- typecast=true 로 singleSelect 자동 옵션 추가

### 스키마 (fields)
- field **create** (`POST /meta/bases/{baseId}/tables/{tableId}/fields`)
  - **create 가능** type: singleLineText / longText / richText / number / date / dateTime / email / url / phoneNumber / currency / percent / rating / duration / checkbox / singleSelect / multipleSelects / singleCollaborator / multipleCollaborators / multipleAttachments / **multipleRecordLinks** / aiText
  - **create 불가 type (computed)** ❌ — `UNSUPPORTED_FIELD_TYPE_FOR_CREATE`:
    - formula / rollup / multipleLookupValues / count / autoNumber / createdTime / lastModifiedTime / createdBy / lastModifiedBy
    - → 이런 computed field 는 사용자가 **web UI 에서 직접 추가**해야 함
- field **rename** (`PATCH /meta/bases/{baseId}/tables/{tableId}/fields/{fieldId}` → `{name: "..."}`)
- field **option 변경** (제한적):
  - singleSelect 옵션 *추가*: typecast=true 로 record POST 시 자동 ✅
  - singleSelect 기존 choice **color/name 변경**: ❌ `INVALID_REQUEST_UNKNOWN` — web UI 만
  - formula expression 변경: 제한적 (일부만)
- table **create** (`POST /meta/bases/{baseId}/tables`)
- table **rename / 설명 변경** (PATCH)
- base list / get (read 전반)

### 흔히 쓰는 패턴
- 양방향 link 추가: `{ type: "multipleRecordLinks", options: { linkedTableId } }` — 자동 양쪽 sync ✅
- singleSelect 옵션 자동 추가: record POST 시 `typecast=true` → 새 옵션 자동 등록 ✅
- field rename: PATCH `{name: "..."}` ✅
- ❌ formula/rollup/lookup 신규 추가는 **web UI 만 가능** (PAT 로 안 됨)

---

## 불가 ❌ (Web/Metadata API 자체가 endpoint 없음)

| 작업 | 우회 방법 |
|---|---|
| **field 삭제** | web UI 에서 column header → Delete field |
| **field type 변경 (in-place)** ★ 2026-05-05 확정 | web UI 에서 column header → "Customize field type" → 새 type 선택. 또는 새 필드 생성 + 데이터 복사 + rename swap (`mukayu-fields-to-richtext` 패턴) |
| **computed field 신규 생성** (formula / rollup / lookup / count / autoNumber 등) | web UI 에서 + 버튼 → Add field → Type 선택 |
| **table 삭제** | web UI 에서 |
| **base 이름 변경 / 삭제** | web UI 에서 |
| **base 복제** | web UI 에서 (Copy base) |
| **버튼 / 모달 / in-base script** | Scripting Extension paid plan |
| **view 생성/수정** | (제한적, 일부 GET 만) |

→ "삭제" 가 필요하면 **deleteMe!_(이름)** prefix 로 rename 해 두고 사용자가 web UI 에서 일괄 삭제하는 패턴 사용. (시소소 5.0.0 마이그레이션 때 정착된 관행)

---

## 시도 전 체크리스트

1. **권한 검증**: 새 base 작업 시 `curl /v0/meta/whoami` 와 `/v0/meta/bases` 로 토큰 접근 가능한지 먼저 확인
2. **field ID 캐시**: `mukayu-import.mjs` 처럼 `T.{table} = "tbl..."` 와 `F.{table}.{field} = "fld..."` 로 ID 정의해 두면 코드 가독성 향상
3. **slug formula 함정**: formula 결과 (slug 등) 는 record create 응답의 `fields.slug` 에서 읽어 매핑. 한글 이름의 띄어쓰기는 하이픈으로 분리됨 (예: "시즌 추천" → `offer-시즌-추천`)
4. **양방향 link**: 한쪽만 채우면 자동 sync — 양쪽 다 채울 필요 없음
5. **batch 한도**: POST/PATCH 한 번에 records 10개. 11개 이상이면 batch 분할 + sleep(220ms)
6. **rate limit**: 5 req/sec/base. batch 사이 sleep 220ms 면 안전

---

## 잘못 알기 쉬운 것

- ❌ "field 삭제도 PAT 로 된다" → **거짓**. endpoint 자체 없음. web UI 만.
- ❌ "field type 도 PAT PATCH 로 바꾼다" (`{type: "richText"}`) → **거짓**. 2026-05-05 확정 — `INVALID_REQUEST_UNKNOWN` 422. PATCH 는 `name` / `description` 만 받음. 변형 4가지 (`{type, options:null}`, `{type, options:{}}`, `{config:{type,options}}`, `{fieldType}`) 모두 422.
- ❌ "Scripting Extension 의 `_sdk.__mutations` 직접 호출로 type 변경" → **거짓**. 2026-05-05 확정 — `f._sdk` undefined (Scripting 런타임이 internal property 노출 차단). `createFieldAsync` 같은 공개 메서드만 작동.
- ❌ "formula / rollup / lookup field 도 PAT 로 만든다" → **거짓**. computed type 은 `UNSUPPORTED_FIELD_TYPE_FOR_CREATE`. web UI 만.
  - 단 *formula expression 변경* (PATCH) 은 가능 (이미 있는 formula field 의 식 수정).
- ❌ "OSS 가 필요하다" → **불필요**. PAT + 직접 fetch 로 충분. (참고 OSS: `pyairtable`, `airtable.js`, `airtable-blocks-sdk` — 단순 wrapper 일 뿐)
- ✅ **양방향 link 만 PAT 로 추가 가능** — multipleRecordLinks 는 일반 type 으로 분류돼 create 가능. 그 외 computed 는 web UI.

---

## 작업 시작 전 자동 주입 키워드

이 파일은 사용자 메시지에 다음 키워드 포함 시 자동 주입됨:
`airtable | 에어테이블 | 9.0. | mukayu | sisoso | hotelAgency | base | atCreate | doppler.*airtable`
