// airtable adapter — URL parse · schema fetch · records fetch · PATCH/POST batch.
//
// 도구 의존성 최소화: PAT 1개 인자만 받음. 호출자가 ensureDoppler 책임.

import { createClient } from "../airtable-api.mjs";
import { extractBaseId } from "../airtable-input.mjs";

/**
 * Airtable URL 또는 raw ID 에서 base/table/record 추출.
 * table·record 는 옵션.
 *
 * @returns {{baseId, tableId: string|null, recordId: string|null}}
 */
export function parseAirtableUrl(input) {
  const baseId = extractBaseId(input);
  if (!baseId) throw new Error(`Airtable URL/ID 아님 (app... 못 찾음): ${input}`);
  const s = String(input);
  const tblMatch = s.match(/\b(tbl[A-Za-z0-9]{14})\b/);
  const recMatch = s.match(/\b(rec[A-Za-z0-9]{14})\b/);
  return {
    baseId,
    tableId: tblMatch ? tblMatch[1] : null,
    recordId: recMatch ? recMatch[1] : null,
  };
}

/**
 * schema 만 fetch.
 */
export async function fetchSchema(url, pat) {
  const { baseId } = parseAirtableUrl(url);
  const client = createClient(pat);
  const schema = await client.getSchema(baseId);
  return { baseId, schema };
}

/**
 * schema + 모든 테이블의 records.
 */
export async function fetchSchemaAndRecords(url, pat) {
  const { baseId } = parseAirtableUrl(url);
  const client = createClient(pat);
  const schema = await client.getSchema(baseId);
  const records = {};
  for (const t of schema.tables) {
    records[t.name] = await client.listRecords(baseId, t.id);
  }
  return { baseId, schema, records };
}

/**
 * 단일 record PATCH.
 */
export async function patchRecord({ baseId, tableId, recordId, fields, pat }) {
  const client = createClient(pat);
  return await client.batchPatch(baseId, tableId, [{ id: recordId, fields }]);
}

/**
 * records 배열 처리: id 있으면 PATCH, 없으면 POST. batch 10개씩 (Airtable 한도).
 *
 * @param records [{id?, fields}, ...]
 * @returns {{patched: number, created: number}}
 */
export async function createOrPatchRecords({ baseId, tableId, records, pat }) {
  const client = createClient(pat);
  const toPatch = records.filter(r => r.id);
  const toCreate = records.filter(r => !r.id);
  const out = { patched: 0, created: 0 };
  if (toPatch.length) {
    const r = await client.batchPatch(baseId, tableId, toPatch);
    out.patched = r.length;
  }
  if (toCreate.length) {
    const r = await client.batchCreate(baseId, tableId, toCreate.map(x => ({ fields: x.fields })));
    out.created = r.length;
  }
  return out;
}

export function tableIdByName(schema, name) {
  const t = schema.tables.find(t => t.name === name);
  return t ? t.id : null;
}

/**
 * schema → claude 한테 보낼 컴팩트 JSON. (id 같은 디테일 제거 — 토큰 절약, name 만)
 */
export function compactSchema(schema) {
  return schema.tables.map(t => ({
    name: t.name,
    id: t.id,
    description: t.description || undefined,
    fields: t.fields.map(f => {
      const out = { name: f.name, type: f.type };
      if (f.description) out.description = f.description;
      if (f.options) out.options = f.options;
      return out;
    }),
  }));
}
