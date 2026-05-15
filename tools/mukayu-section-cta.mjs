#!/usr/bin/env node
// mukayu-section-cta.mjs — 10 list section 의 ctaText 일괄 PATCH

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const SECTION_TBL = 'tblKy64yavSnr5WPG';

const CTAS = {
  '오퍼-list':    '더 알아보기',
  '소식-list':    '원문 보기',
  '객실-list':    '객실 보기',
  '시설-list':    '시설 둘러보기',
  '요리-list':    '메뉴 보기',
  '스파-list':    '트리트먼트 보기',
  '어메니티-list': '어메니티 보기',
  '체험-list':    '체험 신청',
  '오시는길-list': '교통편 안내',
  '예약-list':    '예약 안내',
};

async function listBy(slugs) {
  const f = `OR(${slugs.map(s => `{slug}='${s}'`).join(',')})`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${SECTION_TBL}?filterByFormula=${encodeURIComponent(f)}`, { headers: H });
  if (!r.ok) throw new Error(`GET: ${r.status}`);
  const map = {};
  (await r.json()).records.forEach(rec => { map[rec.fields.slug] = rec.id; });
  return map;
}

async function patch(ups) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${SECTION_TBL}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: ups, typecast: true }),
  });
  if (!r.ok) throw new Error(`PATCH: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}

console.log('section IDs 확보...');
const map = await listBy(Object.keys(CTAS));
console.log(`  ${Object.keys(map).length}/${Object.keys(CTAS).length} found`);

const updates = Object.entries(CTAS)
  .filter(([slug]) => map[slug])
  .map(([slug, cta]) => ({ id: map[slug], fields: { ctaText: cta } }));

console.log(`PATCH (batch 10)...`);
for (let i = 0; i < updates.length; i += 10) {
  const res = await patch(updates.slice(i, i + 10));
  res.forEach(r => console.log(`  ✅ ${r.fields.slug}: "${r.fields.ctaText}"`));
}

console.log(`\n완료: ${updates.length} sections`);
