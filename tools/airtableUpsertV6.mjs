#!/usr/bin/env node
// airtable Upsert V6 — 기존 base에 CSV 데이터 idempotent push (slugKey 기준)
//
// V5 (새 base 생성) 의 짝. 모델 base는 web UI에서 복제 후 V6로 데이터만 채움.
// computed type field 생성 한계(rollup/lookup/autoNumber)를 우회 — 스키마 X, 데이터만.
//
// 사용:
//   AIRTABLE_PAT=... node airtableUpsertV6.mjs <base_id> <data_dir> [--dry-run]
//   AIRTABLE_PAT=... node airtableUpsertV6.mjs appXXX ~/Downloads/sisoso_data
//
// data_dir 프로토콜 (엄격히 — idempotent 보장의 근거):
//   data_dir/
//     upsert.config.json   (선택) — matchKey/linkSeparator/tables override
//     <table>.csv           — 파일명 stem = base 의 테이블명 (정확히 일치)
//
// CSV 헤더 — base 의 필드명 그대로:
//   base 에 "name" 컬럼이면 CSV 헤더도 "name". 모든 컬럼 다 박을 필요 X — 채울 것만.
//   slugKey 컬럼은 반드시 포함 (영문 stable key).
//
// 컬럼별 셀 값 규칙:
//   텍스트/숫자/날짜/URL/이메일 등          → 값 그대로
//   singleSelect                          → 옵션 이름 그대로
//   multipleSelects                        → "|" 구분
//   checkbox                              → "true" / "false"
//   multipleRecordLinks (link)            → target 테이블의 slugKey 들, "|" 구분
//   attachments                           → URL 들, "|" 구분
//   formula/lookup/autoNumber/rollup      → 박지 마 (있어도 자동 skip)
//   빈 셀                                  → 변경 안 함 (기존 값 유지)
//
// matchKey (slugKey) — 동일 input → 동일 결과의 핵심:
//   영문 stable key, 절대 변하지 X. 같은 값이면 update, 없으면 create.
//   base 에 slugKey field 없으면 V6 가 자동 생성 (한 번만).
//
// 동작 (idempotent — 매번 같은 input = 같은 base 상태):
//   1. base 스키마 fetch (필드 타입, link target 자동 추론)
//   2. 각 테이블에 matchKey field 없으면 생성 (한 번만)
//   3. Pass 1 — fields-only performUpsert (Airtable native upsert, fieldsToMergeOn: [matchKey])
//   4. Pass 2 — link 컬럼 resolve (target table 의 matchKey → recId) → PATCH
//
// destructive 안 함: CSV에 없는 base record는 손 안 댐.

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

// ─────────────────────────── CLI args
const args = process.argv.slice(2);
const opts = { dryRun: false };
const positional = [];
for (const a of args) {
  if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  else positional.push(a);
}
const [baseId, dataDir] = positional;
if (!baseId || !dataDir) { printHelp(); process.exit(1); }
if (!fs.existsSync(dataDir)) { console.error(`data_dir not found: ${dataDir}`); process.exit(1); }

const pat = process.env.AIRTABLE_PAT;
if (!pat) { console.error('AIRTABLE_PAT environ not set'); process.exit(1); }

function printHelp() {
  console.log(`Usage: AIRTABLE_PAT=... node airtableUpsertV6.mjs <base_id> <data_dir> [--dry-run]`);
}

// ─────────────────────────── main
const api = createClient(pat);

console.log(`base: ${baseId}  dataDir: ${dataDir}  ${opts.dryRun ? '[DRY-RUN]' : ''}`);

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

// matchKey field 추가 후 schema 재-fetch (live 만, link target 등 정확하게)
if (!opts.dryRun) {
  const refreshed = await api.getSchema(baseId);
  Object.assign(schema, analyzeSchema(refreshed));
}

// 3) transform rows
const transformed = {};  // tableName → [{ fields, linkKeys, matchKeyValue }]
for (const [tableName, t] of Object.entries(data)) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema) continue;
  transformed[tableName] = t.rows.map(row => {
    const { fields, linkKeys } = transformRow(tableName, row, schema, schema.linksByTable, config.linkSeparator);
    return { fields, linkKeys, matchKeyValue: fields[t.matchKey] };
  }).filter(r => r.matchKeyValue);  // matchKey 없는 row는 skip
  console.log(`  ${tableName}: ${transformed[tableName].length} rows (${t.rows.length - transformed[tableName].length} skipped without matchKey)`);
}

// 4) Pass 1 — fields-only upsert
console.log('\n── Pass 1: fields-only upsert ──');
const allKeyToId = {};  // tableName → { matchKey → recId }
for (const [tableName, rows] of Object.entries(transformed)) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema || rows.length === 0) continue;
  const matchKey = data[tableName].matchKey;
  const keyToId = await pass1Upsert(api, baseId, tableName, tSchema, rows, matchKey, opts);
  allKeyToId[tableName] = keyToId;
  console.log(`  ${tableName}: ${rows.length} upserted`);
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
