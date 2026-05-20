#!/usr/bin/env node
// airtable Upsert V6 — 기존 base 에 CSV 데이터 idempotent push (slugKey 기준)
//
// SSOT: 이 파일의 const CAPABILITY_DOC 이 V6 capability 의 진실 소스.
//       capabilities/airtable-v6.md 는 pre-commit 이 여기서 자동 generate.
//       사용 규칙 변경 = CAPABILITY_DOC 만 수정. capability doc 직접 수정 X.
//
// 사용:
//   AIRTABLE_PAT=... node airtableUpsertV6.mjs <base_id> <data_dir> [--dry-run]
//   node airtableUpsertV6.mjs --print-capability  (capability doc 출력)

import "./lib/freshness.mjs"

import fs from 'node:fs';
import process from 'node:process';
import { createClient } from './lib/airtable-api.mjs';
import {
  loadDataDir,
  analyzeSchema,
  transformRow,
  pass1Upsert,
  pass2Links,
  ensureMatchKeyField,
} from './lib/airtable-upsert.mjs';

// ─────────────────────────────────────────────────────────────────────────
// CAPABILITY_DOC — SSOT. pre-commit 이 이 const 를 capabilities/airtable-v6.md 로 generate.
// ─────────────────────────────────────────────────────────────────────────
const CAPABILITY_DOC = `# Airtable Upsert V6 — Claude 작업 컨텍스트

> 이 파일은 \`tools/airtableUpsertV6.mjs\` 의 \`CAPABILITY_DOC\` const 에서 자동 생성됨.
> 직접 수정 X — 도구 코드 안 const 만 수정. pre-commit 이 자동 sync.
> UserPromptSubmit hook 으로 Airtable 작업 시 자동 주입.

---

## 한 줄

**기존 Airtable base 에 콘텐츠 push 가 필요하면 V6 (\`airtableCtl\` / \`airtableUpsertV6.mjs\`) 사용.** 모델 base 는 web UI 에서 복제 → V6 로 데이터만 채움. 동일 input → 동일 base 상태 보장 (idempotent).

---

## 사용 시기 (자동 인지 트리거)

다음 케이스에서 V6 워크플로우 따른다:

- 사용자가 "이 base 에 [콘텐츠] 박아줘" / "데이터 채워줘" / "콘텐츠 만들어서 Airtable 에 올려"
- 사용자가 정해진 스키마의 Airtable base 가리키며 새 record / 기존 record 수정 의도
- CSV/JSON 데이터를 Airtable base 에 import 요청

**❌ 사용하지 말 것** (V6 의 역할이 아님):
- 새 base 생성 (= Airtable web UI 또는 사용자 직접)
- 새 field 생성 (= web UI — \`slugKey\` 한 가지만 V6 가 자동)
- record *삭제* (= web UI)

---

## 도구

\`\`\`bash
# 사용자가 직접 = 인터랙티브 (메뉴)
airtableCtl

# Claude / script / cron = CLI
AIRTABLE_PAT=... node ~/Library/.../scripts/tools/airtableUpsertV6.mjs <baseId> <data_dir> [--dry-run] [--extend]
\`\`\`

## 모드 (workerCtl push/stream 같은 두 모드 패턴)

### strict (default) — 안전

- 기존 base 의 record 만 update/create (matchKey 기준)
- 새 field 생성 X (\`slugKey\` 자동 추가만 예외)
- idempotency + destructive 안 함 보장

### extend (\`--extend\` opt-in) — 새 field 자동 추가 허용

- 위 + CSV 헤더에 base 에 없는 컬럼 있으면 → **\`singleLineText\` field 자동 생성**
- log 에 \`<table>.<field>: CREATED\` 명확히 표시
- 사용자가 명시적으로 켤 때만 동작

### V6 가 다루지 않는 schema 변경 (web UI 또는 별도 작업)

- link field (multipleRecordLinks) 추가
- formula / lookup / rollup 식 디자인
- primary field 변경
- field type 변경 (text → number 등)
- field / record 삭제

---

## data_dir 프로토콜 (엄격)

### 구조

\`\`\`
<data_dir>/
  upsert.config.json   (선택, default 안전)
  topics.csv            ← 파일명 stem = base 의 테이블명 (정확히 일치)
  tags.csv
  items.csv
  ...
\`\`\`

### CSV 헤더

- 1행 = **base 의 필드명 그대로**. 다른 이름 X
- base 의 모든 컬럼 다 박을 필요 X — 채울 컬럼만
- **\`slugKey\` 컬럼 필수** (영문 stable key)

### 컬럼별 셀 값 규칙

| base 필드 타입 | CSV 셀 값 |
|---|---|
| 텍스트/숫자/날짜/URL/이메일 | 값 그대로 |
| singleSelect | 옵션 이름 그대로 |
| multipleSelects | \`\\|\` 구분 |
| checkbox | \`"true"\` / \`"false"\` |
| **multipleRecordLinks (link)** | **target 테이블의 \`slugKey\` 들, \`\\|\` 구분** |
| multipleAttachments | URL 들, \`\\|\` 구분 |
| formula / lookup / autoNumber / rollup | **박지 마** (있어도 자동 skip) |
| 빈 셀 | 변경 안 함 |

### link 예시 (가장 중요)

\`\`\`csv
slugKey,name,topic,tags
room_sea_low,바다 숨소리가 가까운 방,rooms,season-spring|theme-sea
                                  ↑               ↑
                            target=topics    target=tags, 다중 = "|"
\`\`\`

---

## Claude 가 콘텐츠 생성할 때 (★)

사용자가 콘텐츠 만들어달라 요청 시 — *직접 V6 형식 CSV 로 출력*:

1. **자료조사 + 컨셉** (대화로 협의)
2. **콘텐츠 생성** — 처음부터 V6 형식 CSV:
   - 각 record 의 \`slugKey\` 영문 stable key 부여
   - link 컬럼 = target table 의 slugKey 들, \`|\` 구분
   - formula/lookup/autoNumber/rollup 컬럼은 빼고
3. **data_dir 에 저장** — \`<table>.csv\` 파일별
4. **V6 push** — \`--dry-run\` 으로 확인 → 실제 실행
5. **결과 보고**

**❌ 사나(외부 LLM) 거치지 마**. 사나 무한 토큰 워크플로우는 폐기 (잘림 + 4-step 마찰).

---

## idempotency 원리

- \`slugKey\` = 매칭 키. 같은 slugKey 면 update, 없으면 create. 변하지 X
- Airtable native \`performUpsert (fieldsToMergeOn: ["slugKey"])\` — Airtable 자체가 매칭/upsert
- link = 2-pass (Pass 1 fields → 매핑 → Pass 2 link)
- **destructive 안 함**: CSV 에 없는 base record 손 안 댐

---

## 잘 잊는 것 5종

1. CSV 헤더는 base 필드명 그대로. \`_record_id\`, \`id\` 같은 다른 이름 박으면 매칭 X
2. \`slugKey\` 는 formula 가 아니라 일반 text — 사용자/Claude 가 명시적으로 박아야 함
3. link 셀에 rec ID (\`rec...\`) 박지 마. slugKey 박아라
4. formula 필드 (예: \`slug = LOWER({name})\`) 매칭 키로 쓰지 마 — drift 발생. 별도 slugKey text field
5. base 가 바뀌면 base ID 만 바꾸기 — 도구/data_dir/워크플로우 그대로

---

## 한 번 셋업 (새 base)

1. Airtable web UI → 모델 base 복제 (\`Duplicate base\`, "Include records" off)
2. 새 base ID 받음
3. V6 첫 실행 — \`slugKey\` field 자동 생성
4. 이후 콘텐츠 push 는 base ID 만 바꿔서 같은 도구

---

## 도구 위치

- 인터랙티브: \`~/bin/airtableCtl\` → \`tools/airtableCtl.mjs\`
- CLI: \`tools/airtableUpsertV6.mjs\`
- lib: \`tools/lib/airtable-api.mjs\`, \`tools/lib/airtable-upsert.mjs\`
- 자세한 옵션: \`airtableCtl --help\`

V5 (\`airtableGenericV5_deleteMe.py\`) 는 폐기 — computed field create 한계로 우회 결정.
`;

// ─────────────────────────── CLI args
const args = process.argv.slice(2);
const opts = { dryRun: false, extend: false };
const positional = [];
for (const a of args) {
  if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--extend') opts.extend = true;
  else if (a === '--help' || a === '-h') { console.log(CAPABILITY_DOC); process.exit(0); }
  else if (a === '--print-capability') { process.stdout.write(CAPABILITY_DOC); process.exit(0); }
  else positional.push(a);
}
const [baseId, dataDir] = positional;
if (!baseId || !dataDir) {
  console.error(`Usage: AIRTABLE_PAT=... node airtableUpsertV6.mjs <base_id> <data_dir> [--dry-run] [--extend]`);
  console.error(`       node airtableUpsertV6.mjs --help              (사용 규칙 출력)`);
  console.error(`       node airtableUpsertV6.mjs --print-capability  (capability doc — pre-commit 이 호출)`);
  process.exit(1);
}
if (!fs.existsSync(dataDir)) { console.error(`data_dir not found: ${dataDir}`); process.exit(1); }

const pat = process.env.AIRTABLE_PAT;
if (!pat) { console.error('AIRTABLE_PAT environ not set'); process.exit(1); }

// ─────────────────────────── main
const api = createClient(pat);

const modeLabel = opts.extend ? '[EXTEND]' : '[strict]';
console.log(`base: ${baseId}  dataDir: ${dataDir}  ${modeLabel}  ${opts.dryRun ? '[DRY-RUN]' : ''}`);

// 1) load data + schema
const { config, tables: data } = loadDataDir(dataDir);
console.log(`config.matchKey=${config.matchKey} linkSeparator="${config.linkSeparator}" tables=${Object.keys(data).join(',')}`);

const rawSchema = await api.getSchema(baseId);
const schema = analyzeSchema(rawSchema);

// 2) matchKey field 보장
console.log('\n── ensure matchKey field ──');
for (const tableName of Object.keys(data)) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema) { console.warn(`  ${tableName}: base에 없는 테이블 — skip`); continue; }
  const matchKey = data[tableName].matchKey;
  const created = await ensureMatchKeyField(api, baseId, tSchema, matchKey, opts);
  console.log(`  ${tableName}.${matchKey}: ${created ? 'CREATED' : 'exists'}`);
  // schema 에 가상 추가 (dry-run/live 모두 일관) — transformRow 가 matchKey 컬럼 인식하도록
  if (created && !tSchema.fields.some(f => f.name === matchKey)) {
    tSchema.fields.push({ name: matchKey, type: 'singleLineText' });
  }
}

// 2-bis) extend mode — CSV 헤더에 base 에 없는 컬럼 있으면 singleLineText 로 자동 생성
if (opts.extend) {
  console.log('\n── extend mode — new fields ──');
  for (const [tableName, t] of Object.entries(data)) {
    const tSchema = schema.tablesByName[tableName];
    if (!tSchema) continue;
    const existing = new Set(tSchema.fields.map(f => f.name));
    const csvHeaders = new Set();
    for (const row of t.rows) Object.keys(row).forEach(k => csvHeaders.add(k));
    const newCols = [...csvHeaders].filter(h => !existing.has(h));
    for (const col of newCols) {
      if (opts.dryRun) {
        console.log(`  [DRY] ${tableName}.${col}: would CREATE (singleLineText)`);
        tSchema.fields.push({ name: col, type: 'singleLineText' });  // 가상 추가
      } else {
        await api.createField(baseId, tSchema.id, {
          name: col,
          type: 'singleLineText',
          description: 'Auto-created by V6 extend mode',
        });
        tSchema.fields.push({ name: col, type: 'singleLineText' });
        console.log(`  ${tableName}.${col}: CREATED (singleLineText)`);
      }
    }
    if (newCols.length === 0) console.log(`  ${tableName}: 모든 CSV 컬럼이 base 에 이미 존재`);
  }
}

// matchKey field + extend fields 추가 후 schema 재-fetch (live 만)
if (!opts.dryRun) {
  const refreshed = await api.getSchema(baseId);
  Object.assign(schema, analyzeSchema(refreshed));
}

// 3) transform rows
const transformed = {};
for (const [tableName, t] of Object.entries(data)) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema) continue;
  transformed[tableName] = t.rows.map(row => {
    const { fields, linkKeys } = transformRow(tableName, row, schema, schema.linksByTable, config.linkSeparator);
    return { fields, linkKeys, matchKeyValue: fields[t.matchKey] };
  }).filter(r => r.matchKeyValue);
  console.log(`  ${tableName}: ${transformed[tableName].length} rows (${t.rows.length - transformed[tableName].length} skipped without matchKey)`);
}

// 4) Pass 1 — fields-only upsert
console.log('\n── Pass 1: fields-only upsert ──');
const allKeyToId = {};
for (const [tableName, rows] of Object.entries(transformed)) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema || rows.length === 0) continue;
  const matchKey = data[tableName].matchKey;
  const keyToId = await pass1Upsert(api, baseId, tableName, tSchema, rows, matchKey, opts);
  allKeyToId[tableName] = keyToId;
  console.log(`  ${tableName}: ${rows.length} upserted`);
}

// 4-bis) link target 매핑 확장 — base 의 기존 record 까지 포함
// (link 가 기존 base record 를 가리키는 케이스 = 가장 흔함. sisoso items 가 mukayu group 에 link 같은 거.)
console.log('\n── link target 매핑 (기존 base record 포함) ──');
for (const tableName of Object.keys(schema.tablesByName)) {
  const tSchema = schema.tablesByName[tableName];
  const matchKey = data[tableName]?.matchKey || config.matchKey;
  if (!tSchema.fields.some(f => f.name === matchKey)) continue;
  // fields 옵션 안 줌 — dry-run 시 가상 추가된 field 가 base 에 없어 422 회피
  const all = await api.listRecords(baseId, tSchema.id);
  allKeyToId[tableName] = allKeyToId[tableName] || {};
  for (const r of all) {
    const k = r.fields[matchKey];
    if (k && !allKeyToId[tableName][k]) allKeyToId[tableName][k] = r.id;
  }
  console.log(`  ${tableName}: ${Object.keys(allKeyToId[tableName]).length} keys`);
}

// 5) Pass 2 — link resolution
console.log('\n── Pass 2: link resolve + patch ──');
for (const [tableName, rows] of Object.entries(transformed)) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema || rows.length === 0) continue;
  const matchKey = data[tableName].matchKey;
  const keyToId = allKeyToId[tableName];
  const recIds = rows.map(r => keyToId[r.matchKeyValue]);
  const cnt = await pass2Links(api, baseId, tableName, tSchema, rows, recIds, allKeyToId, schema.linksByTable, opts);
  console.log(`  ${tableName}: ${cnt} link updates`);
}

console.log(`\n${opts.dryRun ? 'DRY-RUN DONE.' : 'DONE.'}`);
