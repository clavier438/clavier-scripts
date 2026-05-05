# Airtable Scripting Extension — Claude 작업 컨텍스트

> 자동 주입: UserPromptSubmit hook (`tools/contextInject.json` domain=airtable)
> 마지막 갱신: 2026-05-05 (Airtable/blocks SDK source 기준)
> 원본 mirror: `docs/airtable-blocks-sdk/` — 매일 03:00 새벽루틴 fetch (OVERNIGHT_QUEUE 영구 항목)
> 추가 source 필요 시: `docs/airtable-blocks-sdk/` 의 raw 파일 직접 grep

---

## 한 줄

**Scripting Extension 의 SDK = Airtable/blocks 와 거의 동일** (subset). 추측 단정 금지 — 새 메서드/options 사용 전 *capabilities 또는 docs/ 직접 확인*.

PAT REST API 와 능력 비교는 별도 → `capabilities/airtable.md`.

---

## Table 클래스 메서드 (정확)

source: [`docs/airtable-blocks-sdk/src/models/table.ts`](../../docs/airtable-blocks-sdk/src/models/table.ts)

### Field 조회 (★ 자주 추측 실수)

```typescript
table.getFieldByIdIfExists(fieldId): Field | null
table.getFieldById(fieldId): Field                    // throw if not found
table.getFieldByNameIfExists(fieldName): Field | null
table.getFieldByName(fieldName): Field                // throw if not found
table.getFieldIfExists(idOrName): Field | null
table.getField(idOrName): Field                       // throw if not found
```

⚠️ **Scripting Extension 환경에서 일부 SDK 메서드 노출 안 됨** 가능성 (2026-05-05 발견 — `getFieldByNameIfExists` 가 `is not a function` 에러). **가장 안전한 패턴**:
```javascript
const findField = (tbl, name) => tbl.fields.find(f => f.name === name);
```

### Field 생성

```typescript
table.createFieldAsync(
    name: string,
    type: FieldType,
    options?: FieldOptions | null,
    description?: string | null
): Promise<Field>
```

**create 가능 type** (공식 docs / community 답변):
- `singleLineText` / `multilineText` / `richText` / `email` / `url` / `phoneNumber`
- `number` / `percent` / `currency` / `duration` / `rating`
- `singleSelect` / `multipleSelects`
- `singleCollaborator` / `multipleCollaborators`
- `multipleAttachments`
- `multipleRecordLinks`
- `date` / `dateTime`
- `checkbox` / `barcode`
- `aiText` (1.18.0+, 2023-09-15)
- `richText` (0.0.46+, 2020-04-16)

**create 불가 type** (community 답변, 단 *outdated* 가능성 — 사용자 시도로 검증 필요):
- ~~`autoNumber`~~ / ~~`button`~~ / ~~`count`~~
- ~~`createdBy`~~ / ~~`createdTime`~~ / ~~`lastModifiedBy`~~ / ~~`lastModifiedTime`~~
- ~~`externalSyncSource`~~
- ~~`formula`~~ — **2026-05-05 사용자 직접 시도 = 가능 입증** (`{ formula: "1+1" }`). community 답변 outdated.
- ~~`multipleLookupValues`~~ — 미검증 (2026-05-05 시도 결과 대기)
- ~~`rollup`~~ — 미검증

→ **공식 docs vs 사용자 시도 불일치** 시 *사용자 시도 = truth*. 검증 결과는 RAY_DALIO_QUEUE 처리 후 `PRINCIPLES.md` 에 영구 누적.

### Record CRUD

```typescript
table.selectRecordsAsync(opts?): Promise<TableOrViewQueryResult>
table.createRecordAsync(fields): Promise<RecordId>
table.createRecordsAsync(records[]): Promise<Array<RecordId>>  // 50 limit
table.updateRecordAsync(idOrRec, fields): Promise<void>
table.updateRecordsAsync(records[]): Promise<void>             // 50 limit
table.deleteRecordAsync(idOrRec): Promise<void>
table.deleteRecordsAsync(idsOrRecs[]): Promise<void>           // 50 limit
```

### Properties

```typescript
table.name: string
table.description: string | null
table.url: string
table.primaryField: Field
table.fields: Array<Field>          // ★ getFieldByNameIfExists 대안: tbl.fields.find(...)
table.views: Array<View>
table.parentBase: Base
```

---

## Field type options (정확한 인터페이스)

source: [`docs/airtable-blocks-sdk/src/types/field.ts`](../../docs/airtable-blocks-sdk/src/types/field.ts)

### multipleRecordLinks
```typescript
{
    linkedTableId: TableId;       // ★ create 시 필수
    inverseLinkFieldId?: FieldId;
    viewIdForRecordSelection?: ViewId;
    isReversed: boolean;
    prefersSingleRecordLink: boolean;
}
```

### rollup
```typescript
{
    isValid: boolean;
    referencedFieldIds: Array<FieldId>;
    recordLinkFieldId: FieldId;        // ★ create 시 필수
    fieldIdInLinkedTable: FieldId;     // ★ create 시 필수
    result: FieldConfig;
}
```

⚠️ `aggregationFormula` 가 type def 에 *없음*. 2026-05-05 미검증. 시도 패턴: `createFieldAsync` 호출 시 `aggregationFormula: 'ARRAYJOIN(values, ",")'` 박은 후 실패하면 빼고 재시도 → 빈 rollup 만들어지면 사용자 web UI 에서 formula 입력.

### multipleLookupValues (lookup)
```typescript
{
    isValid: boolean;
    recordLinkFieldId: FieldId;
    fieldIdInLinkedTable: FieldId | null;
    result: FieldConfig | undefined;
}
```

### multipleAttachments
```typescript
{ isReversed: boolean }   // create 시 옵션 없어도 됨
```

### autoNumber
**No options interface**. create 시 `options` 자체 미전달. (단 createFieldAsync 가능 여부는 미검증 — 2026-05-05 시도 결과 대기)

---

## 흔한 실수 패턴 (Ray Dalio 큐 누적)

- ❌ `tbl.getFieldByNameIfExists(name)` 사용 — Scripting 환경 SDK 가 노출 X. **`tbl.fields.find(f => f.name === name)` 사용**
- ❌ rollup 의 `aggregationFormula` 옵션 단정 — type def 에 없음. 시도해서 검증
- ❌ "computed field 안 된다" 단정 — community 답변 outdated. 시도해서 검증 (`formula` 는 가능 입증됨 2026-05-05)
- ❌ Automation "Run a script" 에서 createFieldAsync 시도 — Scripting Extension 환경에서만 (Run a script 는 schema 조작 X)

---

## 작업 시작 전 체크리스트

1. **이 capabilities 자동 주입 확인**: airtable / scripting / mukayu / 9.1. 등 키워드 매칭 시 자동
2. **새 메서드 사용 전**: `docs/airtable-blocks-sdk/table.ts` 또는 `field.ts` grep
3. **새 type 의 createFieldAsync**: try/catch + fallback 패턴. 추측 단정 X
4. **사용자 시도 결과 = truth**: docs 답변과 다르면 사용자 시도 우선

---

## 자동 mirror 시스템

`docs/airtable-blocks-sdk/` 가 매일 03:00 새벽루틴 (queue 부하) 가 fetch:
- CHANGELOG.md
- README.md
- src/types/field.ts
- src/models/table.ts
- src/models/base.ts
- src/models/field.ts
- src/models/record.ts

variation 시 `git diff` 로 변경 감지 → commit + push. 즉 *Airtable SDK 변경* 이 다음 날 새벽 자동 인지.

스크립트: `tools/airtable-scripting-docs-fetch.sh`
영구 항목: `clavier-hq/OVERNIGHT_QUEUE.md` "매일 자동 실행 (영구)" 섹션

---

## 작업 시작 전 자동 주입 키워드

`airtable | 에어테이블 | 9\.0\. | 9\.1\. | mukayu | sisoso | hotelAgency | atCreate | AIRTABLE_PAT | scripting | createFieldAsync | base.getTable | doppler.*airtable`
