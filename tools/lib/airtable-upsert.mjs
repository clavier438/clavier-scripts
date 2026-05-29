// V6 upsert 로직 — CSV 데이터 → 기존 base에 idempotent push (slugKey 기준)
// 2-pass: Pass 1 fields-only upsert → Pass 2 link 컬럼 resolve + PATCH
// formula/lookup/autoNumber/rollup 자동 skip. base 스키마 자동 fetch.

import fs from 'node:fs';
import path from 'node:path';
import { cyan, green, yellow, gray } from './cli-color.mjs';

const COMPUTED_TYPES = new Set([
  'formula', 'multipleLookupValues', 'rollup', 'count',
  'autoNumber', 'createdTime', 'lastModifiedTime',
  'createdBy', 'lastModifiedBy', 'button',
]);

// ─────────────────────────── CSV (RFC 4180-ish)
export function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuote = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"' && field === '') { inQuote = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      field += c; i++;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.length > 1 || (r.length === 1 && r[0]))
    .map(r => {
      const o = {};
      headers.forEach((h, idx) => o[h] = (r[idx] ?? '').trim());
      return o;
    });
}

// ─────────────────────────── data_dir 로드
// data_dir/upsert.config.json (선택) + <table>.csv
export function loadDataDir(dataDir) {
  const configPath = path.join(dataDir, 'upsert.config.json');
  let config = { matchKey: 'slugKey', linkSeparator: '|', tables: {} };
  if (fs.existsSync(configPath)) {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  }
  // 폴더 안의 *.csv 자동 발견 (테이블명 = 파일명 stem)
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));
  const tables = {};
  for (const f of files) {
    const name = path.basename(f, '.csv');
    if (config.skipTables?.includes(name)) continue;
    const tableConfig = config.tables[name] || {};
    tables[name] = {
      matchKey: tableConfig.matchKey || config.matchKey,
      rows: parseCSV(fs.readFileSync(path.join(dataDir, f), 'utf8')),
    };
  }
  return { config, tables };
}

// ─────────────────────────── schema 분석 — link target 자동 추론
// schema → { tablesByName, tablesById, linksByTable: { [tableName]: { [fieldName]: targetTableName } } }
export function analyzeSchema(schema) {
  const tablesByName = {};
  const tablesById = {};
  for (const t of schema.tables) {
    tablesByName[t.name] = t;
    tablesById[t.id] = t;
  }
  const linksByTable = {};
  for (const t of schema.tables) {
    linksByTable[t.name] = {};
    for (const f of t.fields) {
      if (f.type === 'multipleRecordLinks') {
        const targetId = f.options?.linkedTableId;
        const targetName = tablesById[targetId]?.name;
        if (targetName) linksByTable[t.name][f.name] = targetName;
      }
    }
  }
  return { tablesByName, tablesById, linksByTable };
}

// ─────────────────────────── CSV row → { fields, linkKeys }
// linkKeys: { [fieldName]: [matchKey-of-target-record, ...] }
export function transformRow(tableName, row, schema, linksByTable, linkSeparator) {
  const tSchema = schema.tablesByName[tableName];
  if (!tSchema) throw new Error(`Table not found in base: ${tableName}`);
  const fieldsByName = Object.fromEntries(tSchema.fields.map(f => [f.name, f]));
  const linkMap = linksByTable[tableName] || {};

  const fields = {};
  const linkKeys = {};

  for (const [k, v] of Object.entries(row)) {
    if (!v && v !== '0' && v !== 'false') continue;  // 빈 셀 skip (false/0은 제외)
    const f = fieldsByName[k];
    if (!f) continue;  // base에 없는 컬럼 skip
    if (COMPUTED_TYPES.has(f.type)) continue;  // formula 등 skip

    if (f.type === 'multipleRecordLinks') {
      const keys = v.split(linkSeparator).map(s => s.trim()).filter(Boolean);
      if (keys.length) linkKeys[k] = keys;
    } else if (f.type === 'checkbox') {
      fields[k] = String(v).toLowerCase() === 'true';
    } else if (f.type === 'multipleSelects') {
      fields[k] = v.split(linkSeparator).map(s => s.trim()).filter(Boolean);
    } else if (f.type === 'number' || f.type === 'percent' || f.type === 'currency' || f.type === 'rating' || f.type === 'duration') {
      const n = Number(v);
      if (!isNaN(n)) fields[k] = n;
    } else if (f.type === 'multipleAttachments') {
      // URL 형태: "url1|url2" → [{url: ...}, ...]
      const urls = v.split(linkSeparator).map(s => s.trim()).filter(Boolean);
      if (urls.length) fields[k] = urls.map(url => ({ url }));
    } else {
      fields[k] = v;
    }
  }

  return { fields, linkKeys };
}

// ─────────────────────────── Pass 1: fields-only performUpsert
// returns: matchKey → recId map (각 테이블별)
export async function pass1Upsert(api, baseId, tableName, tableSchema, rows, matchKey, opts = {}) {
  const payload = rows.map(({ fields }) => ({ fields }));
  if (opts.dryRun) {
    return rows.reduce((acc, r) => {
      const k = r.fields[matchKey];
      if (k) acc[k] = `[dry-run-${tableName}-${k}]`;
      return acc;
    }, {});
  }
  const upserted = await api.batchUpsert(baseId, tableSchema.id, payload, [matchKey]);
  // upserted[i] 와 rows[i] 대응
  const keyToId = {};
  upserted.forEach((rec, i) => {
    const key = rows[i].fields[matchKey];
    if (key) keyToId[key] = rec.id;
  });
  return keyToId;
}

// ─────────────────────────── Pass 2: link 컬럼 → recId 매핑 → PATCH
export async function pass2Links(api, baseId, tableName, tableSchema, rows, recIds, allKeyToId, linksByTable, opts = {}) {
  const linkMap = linksByTable[tableName] || {};
  const updates = [];
  rows.forEach((r, i) => {
    const recId = recIds[i];
    if (!recId) return;
    const linkFields = {};
    let any = false;
    for (const [fname, keys] of Object.entries(r.linkKeys)) {
      const targetTable = linkMap[fname];
      if (!targetTable) continue;
      const targetMap = allKeyToId[targetTable] || {};
      const ids = keys.map(k => targetMap[k]).filter(Boolean);
      if (ids.length) { linkFields[fname] = ids; any = true; }
    }
    if (any) updates.push({ id: recId, fields: linkFields });
  });
  if (opts.dryRun || updates.length === 0) return updates.length;
  await api.batchPatch(baseId, tableSchema.id, updates);
  return updates.length;
}

// ─────────────────────────── slugKey field 보장 (없으면 생성)
export async function ensureMatchKeyField(api, baseId, tableSchema, matchKey, opts = {}) {
  const existing = tableSchema.fields.find(f => f.name === matchKey);
  if (existing) {
    if (existing.type !== 'singleLineText') {
      throw new Error(`${tableSchema.name}.${matchKey} exists but is ${existing.type}, not singleLineText`);
    }
    return false;  // 이미 있음
  }
  if (opts.dryRun) return true;
  await api.createField(baseId, tableSchema.id, {
    name: matchKey,
    type: 'singleLineText',
    description: `Stable external key for V6 upsert (non-formula, independent of slug formula)`,
  });
  return true;
}

// ─────────────────────────── orchestration — 전체 upsert flow
// data_dir 의 CSV 들을 base 로 upsert. dry-run 지원.
// 진행 상황은 console.log + cli-color (airtableCtl 의 runUpsert 원본 로직 그대로).
//
// @param api      createClient(pat) 결과
// @param baseId   Airtable base id (app...)
// @param dataDir  CSV 폴더 경로
// @param opts     {dryRun?: bool, extend?: bool}
//
// extend = CSV 헤더에 base 에 없는 컬럼 있으면 singleLineText 로 자동 생성.
export async function executeUpsert(api, baseId, dataDir, opts = {}) {
  const { config, tables: data } = loadDataDir(dataDir);
  console.log(`  ${gray(`config.matchKey=${config.matchKey} linkSeparator="${config.linkSeparator}" tables=${Object.keys(data).join(',')}`)}`);

  let schema = analyzeSchema(await api.getSchema(baseId));

  console.log(gray('  · ensure matchKey field'));
  for (const tableName of Object.keys(data)) {
    const tSchema = schema.tablesByName[tableName];
    if (!tSchema) { console.log(`    ${yellow(tableName)}: base에 없는 테이블 ${gray('(skip)')}`); continue; }
    const matchKey = data[tableName].matchKey;
    const created = await ensureMatchKeyField(api, baseId, tSchema, matchKey, opts);
    console.log(`    ${cyan(tableName)}.${matchKey}: ${created ? green('CREATED') : gray('exists')}`);
    if (created && !tSchema.fields.some(f => f.name === matchKey)) {
      tSchema.fields.push({ name: matchKey, type: 'singleLineText' });
    }
  }

  if (opts.extend) {
    console.log(gray('  · extend mode — new fields'));
    for (const [tableName, t] of Object.entries(data)) {
      const tSchema = schema.tablesByName[tableName];
      if (!tSchema) continue;
      const existing = new Set(tSchema.fields.map(f => f.name));
      const csvHeaders = new Set();
      for (const row of t.rows) Object.keys(row).forEach(k => csvHeaders.add(k));
      const newCols = [...csvHeaders].filter(h => !existing.has(h));
      for (const col of newCols) {
        if (opts.dryRun) {
          console.log(`    ${cyan(tableName)}.${col}: ${yellow('would CREATE')} ${gray('(singleLineText, dry)')}`);
          tSchema.fields.push({ name: col, type: 'singleLineText' });
        } else {
          await api.createField(baseId, tSchema.id, {
            name: col, type: 'singleLineText',
            description: 'Auto-created by V6 extend mode',
          });
          tSchema.fields.push({ name: col, type: 'singleLineText' });
          console.log(`    ${cyan(tableName)}.${col}: ${green('CREATED')} (singleLineText)`);
        }
      }
    }
  }

  if (!opts.dryRun) schema = analyzeSchema(await api.getSchema(baseId));

  console.log(gray('  · transform CSV rows'));
  const transformed = {};
  for (const [tableName, t] of Object.entries(data)) {
    if (!schema.tablesByName[tableName]) continue;
    transformed[tableName] = t.rows.map(row => {
      const { fields, linkKeys } = transformRow(tableName, row, schema, schema.linksByTable, config.linkSeparator);
      return { fields, linkKeys, matchKeyValue: fields[t.matchKey] };
    }).filter(r => r.matchKeyValue);
    const skipped = t.rows.length - transformed[tableName].length;
    console.log(`    ${cyan(tableName)}: ${transformed[tableName].length} rows${skipped ? gray(` (${skipped} skipped — no matchKey)`) : ''}`);
  }

  console.log(gray('  · Pass 1 — fields-only upsert'));
  const allKeyToId = {};
  for (const [tableName, rows] of Object.entries(transformed)) {
    if (rows.length === 0) continue;
    const tSchema = schema.tablesByName[tableName];
    const matchKey = data[tableName].matchKey;
    const keyToId = await pass1Upsert(api, baseId, tableName, tSchema, rows, matchKey, opts);
    allKeyToId[tableName] = keyToId;
    console.log(`    ${cyan(tableName)}: ${rows.length} upserted ${opts.dryRun ? gray('(dry)') : green('✓')}`);
  }

  console.log(gray('  · link target 매핑 (기존 base record 포함)'));
  for (const tableName of Object.keys(schema.tablesByName)) {
    const tSchema = schema.tablesByName[tableName];
    const matchKey = data[tableName]?.matchKey || config.matchKey;
    if (!tSchema.fields.some(f => f.name === matchKey)) continue;
    const all = await api.listRecords(baseId, tSchema.id);
    allKeyToId[tableName] = allKeyToId[tableName] || {};
    for (const r of all) {
      const k = r.fields[matchKey];
      if (k && !allKeyToId[tableName][k]) allKeyToId[tableName][k] = r.id;
    }
  }

  console.log(gray('  · Pass 2 — link resolve'));
  for (const [tableName, rows] of Object.entries(transformed)) {
    if (rows.length === 0) continue;
    const tSchema = schema.tablesByName[tableName];
    const matchKey = data[tableName].matchKey;
    const recIds = rows.map(r => allKeyToId[tableName][r.matchKeyValue]);
    const cnt = await pass2Links(api, baseId, tableName, tSchema, rows, recIds, allKeyToId, schema.linksByTable, opts);
    console.log(`    ${cyan(tableName)}: ${cnt} link updates ${opts.dryRun ? gray('(dry)') : (cnt ? green('✓') : gray('—'))}`);
  }

  console.log(`\n  ${opts.dryRun ? yellow('DRY-RUN 완료') : green('UPSERT 완료')}`);
}
