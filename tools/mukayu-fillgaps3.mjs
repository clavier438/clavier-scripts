#!/usr/bin/env node
// mukayu-fillgaps3.mjs — footer 누락 5 items + 2 PATCH
// FAX, RELAIS & CHATEAUX, Hara Design, Instagram, Facebook
// AMORPHE ctaUrl 채움 + 저작권 텍스트 정정

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { section: 'tblKy64yavSnr5WPG', items: 'tblIrbig24H0axx5h' };
const F = {
  items: { name: 'fldQsGF8KULDI2Xdr', caption: 'fldB4gT5wHfIjEIy6',
           ctaUrl: 'fldViPuqLJkZqrxyM', section: 'fldOHZZe3m76HbSfh' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(tbl, recs) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'POST', headers: H, body: JSON.stringify({ records: recs.map(f => ({ fields: f })), typecast: true }),
  });
  if (!r.ok) throw new Error(`POST ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}
async function patch(tbl, ups) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ records: ups, typecast: true }),
  });
  if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}
async function listBy(tbl, slugs) {
  const f = `OR(${slugs.map(s => `{slug}='${s.replace(/'/g, "\\'")}'`).join(',')})`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}?filterByFormula=${encodeURIComponent(f)}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${tbl}: ${r.status}`);
  const map = {};
  (await r.json()).records.forEach(rec => { map[rec.fields.slug] = rec.id; });
  return map;
}
async function batchPost(tbl, recs) {
  const out = [];
  for (let i = 0; i < recs.length; i += 10) {
    out.push(...await post(tbl, recs.slice(i, i + 10)));
    if (i + 10 < recs.length) await sleep(220);
  }
  return out;
}

console.log('[1/3] brand-footer ID 확보...');
const sectionMap = await listBy(T.section, ['brand-footer']);
const brandFooterId = sectionMap['brand-footer'];
if (!brandFooterId) throw new Error('brand-footer not found');

console.log('[2/3] 새 footer items (5)...');
const NEW_ITEMS = [
  { name: '+81-(0)761-76-1340',                    caption: 'FAX',                ctaUrl: 'tel:+81761761340' },
  { name: 'RELAIS & CHATEAUX',                     caption: '인증',               ctaUrl: 'https://www.relaischateaux.com/us/' },
  { name: 'Hara Design Institute / Kenya Hara',    caption: '디자인',             ctaUrl: 'https://www.ndc.co.jp/hara/' },
  { name: 'Instagram',                             caption: 'Instagram',          ctaUrl: '' },
  { name: 'Facebook',                              caption: 'Facebook',           ctaUrl: '' },
];
const itemsRes = await batchPost(T.items, NEW_ITEMS.map(i => ({
  [F.items.name]:    i.name,
  [F.items.caption]: i.caption,
  ...(i.ctaUrl ? { [F.items.ctaUrl]: i.ctaUrl } : {}),
  [F.items.section]: [brandFooterId],
})));
console.log(`  +items: ${itemsRes.length}`);
await sleep(220);

console.log('[3/3] PATCH — AMORPHE ctaUrl + 저작권 정정...');
const patchTargets = await listBy(T.items, [
  'brand-footer-amorphe-/-kiyoshi-sey-takeyama',
  'brand-footer-©-2026-beniya-mukayu-all-rights-reserved',
]);
const ups = [];
if (patchTargets['brand-footer-amorphe-/-kiyoshi-sey-takeyama']) {
  ups.push({
    id: patchTargets['brand-footer-amorphe-/-kiyoshi-sey-takeyama'],
    fields: { [F.items.ctaUrl]: 'https://www.amorphe.jp/' },
  });
}
if (patchTargets['brand-footer-©-2026-beniya-mukayu-all-rights-reserved']) {
  ups.push({
    id: patchTargets['brand-footer-©-2026-beniya-mukayu-all-rights-reserved'],
    fields: { [F.items.name]: 'MUKAYU. ALL RIGHTS RESERVED.' },
  });
}
await patch(T.items, ups);
console.log(`  patches: ${ups.length}`);

console.log('\n✅ Complete:');
console.log(`  +items=${itemsRes.length}  patches=${ups.length}`);
