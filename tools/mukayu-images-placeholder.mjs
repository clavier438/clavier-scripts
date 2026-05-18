#!/usr/bin/env node
// mukayu-images-placeholder.mjs
// items.img / items.gallery / section.img 비어있는 records 에 Lorem Picsum 자동 PATCH
// seed=slug 로 record 마다 고정 이미지

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { items: 'tblIrbig24H0axx5h', section: 'tblKy64yavSnr5WPG' };
const F = {
  items:   { slug: 'fld4uqcKICUS7sOOf', img: 'fld8XX', gallery: 'fld9YY' },  // resolve at runtime
  section: { slug: 'fldlXmMa0tabekR2N', img: 'fldHcQyIjYxdbbr0V', role: 'fldILF1GvQJweWQPd' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dumpAll(tbl, fieldNames) {
  const records = [];
  let offset = '';
  while (true) {
    const fparam = fieldNames.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    const url = `https://api.airtable.com/v0/${BASE}/${tbl}?pageSize=100${fparam}` + (offset ? `&offset=${offset}` : '');
    const j = await fetch(url, { headers: H }).then(r => r.json());
    if (j.error) throw new Error(JSON.stringify(j.error));
    records.push(...j.records);
    if (!j.offset) break;
    offset = j.offset;
  }
  return records;
}

async function patchBatch(tbl, ups) {
  for (let i = 0; i < ups.length; i += 10) {
    const batch = ups.slice(i, i + 10);
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
      method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
    process.stdout.write(`\r  ${Math.min(i+10, ups.length)}/${ups.length}`);
    await sleep(300);  // image fetch 시간 더 줌
  }
  console.log();
}

const picsum = (seed, w = 800, h = 600) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

// ─── items.img + items.gallery ─────────────────
console.log('[1/2] items img/gallery dump...');
const items = await dumpAll(T.items, ['slug', 'img', 'gallery']);
const itemTargets = items.filter(r =>
  !r.fields.img?.length || !r.fields.gallery?.length
);
console.log(`  total: ${items.length}, mig 대상: ${itemTargets.length}`);

const itemUpdates = itemTargets.map(r => {
  const slug = r.fields.slug;
  const fields = {};
  if (!r.fields.img?.length) {
    fields.img = [{ url: picsum(slug, 800, 600) }];
  }
  if (!r.fields.gallery?.length) {
    fields.gallery = [
      { url: picsum(`${slug}-g1`, 800, 600) },
      { url: picsum(`${slug}-g2`, 800, 600) },
      { url: picsum(`${slug}-g3`, 800, 600) },
    ];
  }
  return { id: r.id, fields };
});
console.log(`  PATCH ${itemUpdates.length} items...`);
await patchBatch(T.items, itemUpdates);

// ─── section.img (intro/list role 만) ──────────
console.log('\n[2/2] section img dump...');
const sections = await dumpAll(T.section, ['slug', 'role', 'img']);
const sectionTargets = sections.filter(r =>
  ['intro', 'list'].includes(r.fields.role) && !r.fields.img?.length
);
console.log(`  total: ${sections.length}, mig 대상 (intro/list & img 비어있음): ${sectionTargets.length}`);

const sectionUpdates = sectionTargets.map(r => ({
  id: r.id,
  fields: { img: [{ url: picsum(r.fields.slug, 1600, 900) }] },
}));
console.log(`  PATCH ${sectionUpdates.length} sections...`);
await patchBatch(T.section, sectionUpdates);

console.log('\n✅ Complete!');
console.log(`  items: ${itemUpdates.length} (img + gallery)`);
console.log(`  sections: ${sectionUpdates.length} (img)`);
console.log(`  Airtable 이 Picsum URL 에서 이미지 fetch + 저장 (백그라운드)`);
