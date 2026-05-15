#!/usr/bin/env node
// mukayu-section-subname-restore.mjs
// section.notes 의 ## H2 prefix → 새 section.subName 분리

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const SECTION_TBL = 'tblKy64yavSnr5WPG';
const F = {
  notes:   'fldxCLS4Qy08N33R1',
  subName: 'fld5flDIQX6lLBjQx',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dumpAll() {
  const records = []; let offset = '';
  while (true) {
    const url = `https://api.airtable.com/v0/${BASE}/${SECTION_TBL}?pageSize=100&fields%5B%5D=slug&fields%5B%5D=name&fields%5B%5D=notes` + (offset ? `&offset=${offset}` : '');
    const j = await fetch(url, { headers: H }).then(r => r.json());
    records.push(...j.records);
    if (!j.offset) break;
    offset = j.offset;
  }
  return records;
}

async function patch(ups) {
  for (let i = 0; i < ups.length; i += 10) {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${SECTION_TBL}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ records: ups.slice(i, i + 10), typecast: true }),
    });
    if (!r.ok) throw new Error(`PATCH: ${r.status} ${await r.text()}`);
    await sleep(220);
  }
}

console.log('[1] section dump...');
const records = await dumpAll();
console.log(`  total: ${records.length}`);

const updates = [];
for (const r of records) {
  const notes = r.fields.notes;
  if (typeof notes !== 'string' || !notes.startsWith('## ')) continue;
  const firstNl = notes.indexOf('\n');
  const headLine = firstNl === -1 ? notes : notes.slice(0, firstNl);
  const subName = headLine.replace(/^##\s+/, '').trim();
  if (!subName) continue;
  let rest = firstNl === -1 ? '' : notes.slice(firstNl + 1);
  rest = rest.replace(/^\n+/, '');
  updates.push({
    id: r.id,
    fields: {
      [F.subName]: subName.slice(0, 200),
      [F.notes]:   rest,
    },
  });
}
console.log(`[2] ## H2 prefix 분리 대상: ${updates.length}`);

if (updates.length === 0) {
  console.log('  (분리할 record 없음 — section.notes 안 ## prefix 없음)');
  process.exit(0);
}

console.log('  샘플:');
updates.slice(0, 3).forEach(u => {
  const orig = records.find(r => r.id === u.id);
  console.log(`    [${orig.fields.slug}] subName ← "${u.fields[F.subName]}"`);
});

console.log(`\n[3] PATCH...`);
await patch(updates);
console.log(`  ✅ ${updates.length} sections`);
