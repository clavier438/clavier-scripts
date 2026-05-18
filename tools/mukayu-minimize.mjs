#!/usr/bin/env node
// mukayu-minimize.mjs — items 미니멀화
// 1) subName / notes2 → notes 안 합침 (richText markdown)
// 2) field rename: subName / notes2 / ctaText / layout_inverted? → deleteMe!_*
// 3) section 은 이미 미니멀 (10 fields), 손대지 않음

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const ITEMS_TBL = 'tblIrbig24H0axx5h';
const F = {
  name:    'fldQsGF8KULDI2Xdr',
  subName: 'fldd9P8bSoOCb6Ne6',
  notes:   'fldvvQ6MI7PLwvE7C',
  notes2:  'fld24FADPYYkJgktl',
  ctaText: 'fldqqfHwYdUcwJNii',
  layoutInverted: 'fldgezwI2MsVpVlVo',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function patchRecord(tbl, ups) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: ups, typecast: true }),
  });
  if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}
async function batchPatch(tbl, ups) {
  for (let i = 0; i < ups.length; i += 10) {
    await patchRecord(tbl, ups.slice(i, i + 10));
    if (i + 10 < ups.length) await sleep(220);
  }
}
async function patchField(tbl, fldId, body) {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tbl}/fields/${fldId}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH field ${fldId}: ${r.status} ${await r.text()}`);
  return await r.json();
}

// ─── 1. subName/notes2 채운 items dump ──────────
console.log('[1/3] items 마이그 대상 dump...');
let records = [];
let offset = '';
while (true) {
  const url = `https://api.airtable.com/v0/${BASE}/${ITEMS_TBL}?pageSize=100` +
              `&fields%5B%5D=subName&fields%5B%5D=notes&fields%5B%5D=notes2&fields%5B%5D=slug` +
              (offset ? `&offset=${offset}` : '');
  const j = await fetch(url, { headers: H }).then(r => r.json());
  records.push(...j.records);
  if (!j.offset) break;
  offset = j.offset;
}
const targets = records.filter(r => r.fields.subName || r.fields.notes2);
console.log(`  total items: ${records.length}, mig 대상: ${targets.length}`);

// ─── 2. notes 합치기 ──────────
console.log('[2/3] notes 합치기 PATCH...');
const updates = targets.map(r => {
  const f = r.fields;
  let newNotes = '';
  if (f.subName) newNotes += `## ${f.subName}\n\n`;
  if (f.notes)   newNotes += f.notes;
  if (f.notes2)  newNotes += `\n\n${f.notes2}`;
  return { id: r.id, fields: { [F.notes]: newNotes } };
});
await batchPatch(ITEMS_TBL, updates);
console.log(`  patched: ${updates.length}`);
await sleep(220);

// ─── 3. field rename ──────────
console.log('[3/3] field rename (deleteMe!_)...');
const RENAMES = [
  { fldId: F.subName,        newName: 'deleteMe!_subName' },
  { fldId: F.notes2,         newName: 'deleteMe!_notes2' },
  { fldId: F.ctaText,        newName: 'deleteMe!_ctaText' },
  { fldId: F.layoutInverted, newName: 'deleteMe!_layout_inverted?' },
];
for (const r of RENAMES) {
  const res = await patchField(ITEMS_TBL, r.fldId, { name: r.newName });
  console.log(`  ${res.name}`);
  await sleep(220);
}

console.log('\n✅ 완료');
console.log(`  +PATCH records: ${updates.length}`);
console.log(`  +RENAMED fields: ${RENAMES.length}`);
console.log(`  → 사용자 web UI 에서 deleteMe!_* 4개 column 삭제`);
