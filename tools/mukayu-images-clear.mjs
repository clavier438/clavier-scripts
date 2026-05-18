#!/usr/bin/env node
// items.img / items.gallery / section.img 모두 비우기

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { items: 'tblIrbig24H0axx5h', section: 'tblKy64yavSnr5WPG' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dumpAll(tbl, fieldNames) {
  const records = []; let offset = '';
  while (true) {
    const fp = fieldNames.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    const url = `https://api.airtable.com/v0/${BASE}/${tbl}?pageSize=100${fp}` + (offset ? `&offset=${offset}` : '');
    const j = await fetch(url, { headers: H }).then(r => r.json());
    records.push(...j.records);
    if (!j.offset) break;
    offset = j.offset;
  }
  return records;
}
async function patchBatch(tbl, ups) {
  for (let i = 0; i < ups.length; i += 10) {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
      method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: ups.slice(i, i + 10), typecast: true }),
    });
    if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
    process.stdout.write(`\r  ${Math.min(i+10, ups.length)}/${ups.length}`);
    await sleep(220);
  }
  console.log();
}

console.log('[1/2] items.img + gallery clear...');
const items = await dumpAll(T.items, ['slug', 'img', 'gallery']);
const itemTargets = items.filter(r => r.fields.img?.length || r.fields.gallery?.length);
const itemUpdates = itemTargets.map(r => ({
  id: r.id,
  fields: { img: [], gallery: [] },
}));
console.log(`  ${itemUpdates.length} items 비움...`);
await patchBatch(T.items, itemUpdates);

console.log('\n[2/2] section.img clear...');
const sections = await dumpAll(T.section, ['slug', 'img']);
const sectionTargets = sections.filter(r => r.fields.img?.length);
const sectionUpdates = sectionTargets.map(r => ({
  id: r.id,
  fields: { img: [] },
}));
console.log(`  ${sectionUpdates.length} sections 비움...`);
await patchBatch(T.section, sectionUpdates);

console.log('\n✅ 모든 이미지 삭제 완료');
