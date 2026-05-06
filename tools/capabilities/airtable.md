# Airtable PAT 작업 가능/불가 — Claude 작업 컨텍스트

> 이 파일은 UserPromptSubmit hook 으로 자동 주입됨.
> 에어테이블 관련 작업 시작 전 자동으로 Claude 컨텍스트에 들어옴.
> 마지막 갱신: 2026-05-07 (Engineer special run — 전수 재검증)

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
  - **create 가능** type: singleLineText / longText / richText / number / date / dateTime / email / url / phoneNumber / currency / percent / rating / duration / checkbox / singleSelect / multipleSelects / singleCollaborator / multipleCollaborators / multipleAttachments / **multipleRecordLinks** / aiText / **formula** ★ 2026-05-06 발견 — 2026-05-07 MCP 채널 재확인
  - **create 불가 type (computed)** ❌ — community 답변 다수 (단 *일부 outdated 가능성* — `formula` 가 실제로 가능했던 전례. 새 type 시도 시 `UNSUPPORTED_FIELD_TYPE_FOR_CREATE` 에러 받으면 그제야 ❌ 확정):
    - rollup / multipleLookupValues / count / autoNumber / createdTime / lastModifiedTime / createdBy / lastModifiedBy / button
    - → 2026-05-07 community 재검색: rollup CREATE 는 여전히 ❌ 보고 다수 (2024-11). 단 *직접 시도* 안 함 (이번 run PAT 없어 MCP 만, MCP enum 이 이 type 을 막음). **다음 PAT 가능 run 에서 직접 시도 필요**.
    - → 만약 끝까지 ❌ 면 web UI 에서 사용자가 직접 추가
- field **rename** (`PATCH /meta/bases/{baseId}/tables/{tableId}/fields/{fieldId}` → `{name: "..."}`) — 2026-05-07 MCP 재확인 ✅
- field **description 변경** (PATCH `{description: "..."}`) — 2026-05-07 MCP 재확인 ✅
- field **formula expression 변경** (PATCH `{options: {formula: "..."}}`) — 2026-05-07 MCP 재확인 ✅
- field **option 변경** (제한적):
  - singleSelect 옵션 *추가*: typecast=true 로 record POST 시 자동 ✅
  - singleSelect 기존 choice **color/name 변경**: ❌ `INVALID_REQUEST_UNKNOWN` (2026-05-05 확정. 2026-05-07 run 은 PAT 없어 재검증 못함) — web UI 만
- table **create** (`POST /meta/bases/{baseId}/tables`) — 2026-05-07 MCP 재확인 ✅
- table **rename / 설명 변경** (PATCH) — 2026-05-07 MCP 재확인 ✅
- base **create** (`POST /meta/bases`) — 2026-05-07 MCP `create_base` 재확인 ✅
- base list / get (read 전반)
- workspace list (`GET /meta/workspaces`) — 2026-05-07 MCP `list_workspaces` 재확인 ✅

### 흔히 쓰는 패턴
- 양방향 link 추가: `{ type: "multipleRecordLinks", options: { linkedTableId } }` — 자동 양쪽 sync ✅. 2026-05-07 sandbox 검증: 응답에 `inverseLinkFieldId` 도 자동 박힘. **단 inverse 필드 이름 = 원본 table 이름 at create-time** — 추후 table rename 해도 자동 갱신 X. (footgun)
- singleSelect 옵션 자동 추가: record POST 시 `typecast=true` → 새 옵션 자동 등록 ✅
- field rename: PATCH `{name: "..."}` ✅
- ✅ **formula 신규 추가** = 가능. body: `{name, type:"formula", options:{formula:"..."}}`. 응답에 `referencedFieldIds`, `result.type`, `isValid` 옴. (2026-05-06 발견 → 2026-05-07 재확인)
- ❌ rollup/lookup 신규 추가는 community 다수 답변 = 여전히 ❌ (2024-11 기준). 단 직접 시도 미완료 — 다음 PAT run 시 검증 대상.

---

## 불가 ❌ (Web/Metadata API 자체가 endpoint 없음 또는 confirmed 거부)

| 작업 | 우회 방법 | 검증 상태 |
|---|---|---|
| **field 삭제** | web UI 에서 column header → Delete field | 2026-05-07 community 재확인 — 여전히 ❌ |
| **field type 변경 (in-place)** | web UI / 새 필드 생성 swap (`mukayu-fields-to-richtext` 패턴) | 2026-05-05 확정. 2026-05-07 PAT 없어 재검증 못함 — 다음 run |
| **computed field 신규 생성** (rollup / lookup / count / autoNumber / button 등 — `formula` 제외) | web UI 에서 + 버튼 → Add field → Type 선택 | 2026-05-07 community 재확인 — 단 formula 가 stale ❌ 였던 전례 있어 *직접 시도* 필요 |
| **table 삭제** | web UI 에서 | 2026-05-07 미검증 — 다음 PAT run |
| **buttons / 모달 / in-base script** | Scripting Extension paid plan | (UI 기반, REST 영역 아님) |
| **view 생성** (CREATE) | web UI 에서 | 2026-05-07 community 재확인 — 여전히 ❌ |
| **view 수정** (rename, filter 등) | web UI 에서 | 2026-05-07 community 재확인 — 여전히 ❌ |

→ "삭제" 가 필요하면 **deleteMe!_(이름)** prefix 로 rename 해 두고 사용자가 web UI 에서 일괄 삭제하는 패턴 사용. (시소소 5.0.0 마이그레이션 때 정착된 관행)

## 가능 가능성 ★ docs evidence 만 — PAT 직접 시도 미완료 (다음 run)

이번 2026-05-07 run 은 PAT 없이 MCP 채널만 — 아래는 **공식 docs 페이지가 실재** 하나 *직접 호출* 미검증. 다음 PAT run 시 박아야 함.

| 작업 | 추정 endpoint | 출처 |
|---|---|---|
| **base 삭제** | `DELETE /v0/meta/bases/{baseId}` | https://airtable.com/developers/web/api/delete-base (페이지 살아있음) |
| **view 삭제** | `DELETE /v0/meta/bases/{baseId}/tables/{tableId}/views/{viewId}` | https://airtable.com/developers/web/api/delete-view |
| **workspace 삭제** | `DELETE /v0/meta/workspaces/{workspaceId}` | https://airtable.com/developers/web/api/delete-workspace |
| **base 복제** | (미발견 endpoint — Copy base 는 web UI 만일 가능성) | docs 검색 결과 별도 endpoint 없음 |

⚠ 위 *추정* 들은 *직접 curl* 시 422 / 404 가능. 다음 PAT run 에서 sandbox base 로 시도 후 ✅ / ❌ 확정.

---

## MCP 채널 (Airtable MCP server) — 2026-05-07 발견

환경에 Airtable MCP 가 연결돼 있으면 (`mcp__c9e7d671-*__*`) PAT 없이도 다음이 가능:
- `list_workspaces` / `list_bases` / `list_tables_for_base` / `get_table_schema`
- `create_base` / `create_table` / `update_table` (name·description)
- `create_field` / `update_field` (name·description·formula expression)
- `create_records_for_table` / `update_records_for_table` / `delete_records_for_table` / `search_records`
- `create_record_comment` / `list_record_comments`

**MCP wrapper 한계 (= 직접 시도 막힘)**:
- `create_field` 의 `type` enum 이 26-ish 표준 type 만 — `rollup` / `count` / `autoNumber` / `createdTime` / `lastModifiedTime` / `createdBy` / `lastModifiedBy` / `multipleLookupValues` / `aiText` / `button` 못 시도. (REST 자체 가능 여부 별개 — MCP 가 막는 것뿐)
- `update_field` 의 `options` 가 `formula` 만 — type 변경 / choice color 변경 등 **MCP 로 시도조차 못 함**.
- DELETE 도구 부재 — base / table / view / field DELETE 못 함.
- view 관련 도구 0개.

→ MCP 채널은 *간단한 schema 조작 + record CRUD* 에 빠르고 안전. *full coverage 가 필요한 capabilities 검증* 은 PAT 가 필요.

---

## ★ formula CREATE 구체 패턴 (2026-05-07 sandbox 검증)

**Request body**:
```json
{
  "name": "Total",
  "type": "formula",
  "options": { "formula": "{Quantity} * {Price}" }
}
```
- `{Field Name}` 또는 `{fldXXXXXXXXXXXXXX}` 둘 다 됨.
- `description` 도 동시에 박을 수 있음 (선택).

**Response (sandbox 실측)**:
```json
{
  "id": "fldHTaW8hOKZsrmau",
  "name": "Total",
  "type": "formula",
  "options": {
    "isValid": true,
    "formula": "{fldBG2rcPX36VvUvr} * {fldSrG2d2Ndi5bLi5}",  // 응답은 항상 ID 로 변환
    "referencedFieldIds": ["fldBG2rcPX36VvUvr", "fldSrG2d2Ndi5bLi5"],
    "result": { "type": "number", "options": { "precision": 0 } }
  }
}
```

**검증**: 응답의 `options.isValid` 가 `true` 인지 확인. `false` 면 식 invalid (참조 field 명 오타 / 순환 참조 등) — 그래도 field 자체는 생성됨.

**formula expression 변경** (PATCH):
```json
PATCH /meta/bases/{baseId}/tables/{tableId}/fields/{fieldId}
{ "options": { "formula": "{Quantity} + {Price}" } }
```
응답: `{"success": true}`.

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
- ❌ "field type 도 PAT PATCH 로 바꾼다" (`{type: "richText"}`) → **거짓**. 2026-05-05 확정 — `INVALID_REQUEST_UNKNOWN` 422. PATCH 는 `name` / `description` / `options.formula` 만 받음. 변형 4가지 (`{type, options:null}`, `{type, options:{}}`, `{config:{type,options}}`, `{fieldType}`) 모두 422.
- ❌ "Scripting Extension 의 `_sdk.__mutations` 직접 호출로 type 변경" → **거짓**. 2026-05-05 확정 — `f._sdk` undefined (Scripting 런타임이 internal property 노출 차단). `createFieldAsync` 같은 공개 메서드만 작동.
- ⚠ "**formula / rollup / lookup** field 도 PAT 로 만든다" → **부분적 거짓**: `formula` 는 가능 ✅ (2026-05-06 발견 → 2026-05-07 MCP 재확인). rollup / lookup / count / autoNumber 등은 *community 답변 다수* 가 ❌ — 단 formula 가 stale ❌ 였던 전례 있어 **다음 PAT run 에서 직접 시도** 필요.
- ❌ "OSS 가 필요하다" → **불필요**. PAT + 직접 fetch 로 충분. (참고 OSS: `pyairtable`, `airtable.js`, `airtable-blocks-sdk` — 단순 wrapper 일 뿐)
- ✅ **양방향 link 만 PAT 로 추가 가능 (computed 중 유일하게 가능했던 type)** — multipleRecordLinks 는 일반 type 으로 분류돼 create 가능. 2026-05-06 부터 formula 도 ✅ 추가됨.
- ⚠ "**docs / community / Blocks SDK 가 ❌ 박았으면 ❌ 다**" → **거짓** (2026-05-06 formula 사례). *직접 시도가 truth*. 새로운 *❌ 박힘* 마주치면 sandbox base 로 직접 변형 5-7개 시도 후 ❌ 확정 — *추측 단정 금지*.

---

## 작업 시작 전 자동 주입 키워드

이 파일은 사용자 메시지에 다음 키워드 포함 시 자동 주입됨:
`airtable | 에어테이블 | 9.0. | mukayu | sisoso | hotelAgency | base | atCreate | doppler.*airtable`
