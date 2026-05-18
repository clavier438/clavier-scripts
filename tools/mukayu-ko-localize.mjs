#!/usr/bin/env node
// mukayu-ko-localize.mjs — 자잘한 데이터·아이템성 항목 한글화
// brand-awards 5 + footer 7 + cuisine subitem 1 = 13 PATCH
// name = 한글, subName = 영문 백업

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { items: 'tblIrbig24H0axx5h', subitems: 'tblH7xgPQDp6Df5dV' };
const F = {
  items:    { name: 'fldQsGF8KULDI2Xdr', subName: 'fldd9P8bSoOCb6Ne6' },
  subitems: { name: 'fldtj8Z90Fr8XlEWE' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
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
async function batchPatch(tbl, ups) {
  const out = [];
  for (let i = 0; i < ups.length; i += 10) {
    out.push(...await patch(tbl, ups.slice(i, i + 10)));
    if (i + 10 < ups.length) await sleep(220);
  }
  return out;
}

// 한글화 매핑 (현재 slug → 한글 name + 영문 subName 백업)
const ITEM_MAPS = [
  // brand-awards (5) — 공식 award 명 한글 + 영문 백업
  { oldSlug: 'brand-awards-authentic-hotels-cruises-welcome-award-2015',
    name: '어센틱 호텔 & 크루즈 웰컴 어워드 2015',  subName: 'AUTHENTIC HOTELS & CRUISES WELCOME AWARD 2015' },
  { oldSlug: 'brand-awards-best-small-hotel-spa-worldwide-2015',
    name: '베스트 스몰 호텔 스파 월드와이드 2015',   subName: 'BEST SMALL HOTEL SPA WORLDWIDE 2015' },
  { oldSlug: 'brand-awards-relais-chateaux-welcome-trophy-2013',
    name: '릴레 앤 샤또 웰컴 트로피 2013',          subName: 'RELAIS & CHATEAUX Welcome Trophy 2013' },
  { oldSlug: 'brand-awards-spa-japan-crystal-awards-professional-2012',
    name: '스파 재팬 크리스탈 어워드 프로페셔널 2012', subName: 'SPA JAPAN CRYSTAL AWARDS PROFESSIONAL 2012' },
  { oldSlug: 'brand-awards-michelin-2025',
    name: '미슐랭 2025',                            subName: 'MICHELIN 2025' },
  // footer 브랜드·SNS·저작권 (7)
  { oldSlug: 'brand-footer-relais-&-chateaux',
    name: '릴레 앤 샤또',  subName: 'RELAIS & CHATEAUX' },
  { oldSlug: 'brand-footer-amorphe-/-kiyoshi-sey-takeyama',
    name: '아모르프 / 키요시 세이 타케야마', subName: 'AMORPHE / Kiyoshi Sey Takeyama' },
  { oldSlug: 'brand-footer-hara-design-institute-/-kenya-hara',
    name: '하라 디자인 인스티튜트 / 켄야 하라', subName: 'Hara Design Institute / Kenya Hara' },
  { oldSlug: 'brand-footer-instagram',
    name: '인스타그램', subName: 'Instagram' },
  { oldSlug: 'brand-footer-facebook',
    name: '페이스북',   subName: 'Facebook' },
  { oldSlug: 'brand-footer-mukayu.-all-rights-reserved.',
    name: 'MUKAYU. 모든 권리 보유.', subName: 'MUKAYU. ALL RIGHTS RESERVED.' },
];

// cuisine subitem (1) — Kanazawa 음역
const SUBITEM_MAPS = [
  { oldSlug: '디너-업그레이드-(연중-가능)-kanazawa-스시-가이세키',
    name: '가나자와 스시 가이세키' },
];

console.log('[1/3] items 한글화 PATCH (' + ITEM_MAPS.length + ')...');
const itemMap = await listBy(T.items, ITEM_MAPS.map(m => m.oldSlug));
console.log('  found:', Object.keys(itemMap).length, '/', ITEM_MAPS.length);
const itemUpdates = ITEM_MAPS.map(m => {
  const id = itemMap[m.oldSlug];
  if (!id) return null;
  return { id, fields: { [F.items.name]: m.name, [F.items.subName]: m.subName } };
}).filter(Boolean);
await batchPatch(T.items, itemUpdates);
console.log(`  patched: ${itemUpdates.length}`);
await sleep(220);

console.log('[2/3] subitems 한글화 PATCH (' + SUBITEM_MAPS.length + ')...');
const subitemMap = await listBy(T.subitems, SUBITEM_MAPS.map(m => m.oldSlug));
console.log('  found:', Object.keys(subitemMap).length, '/', SUBITEM_MAPS.length);
const subitemUpdates = SUBITEM_MAPS.map(m => {
  const id = subitemMap[m.oldSlug];
  if (!id) return null;
  return { id, fields: { [F.subitems.name]: m.name } };
}).filter(Boolean);
await batchPatch(T.subitems, subitemUpdates);
console.log(`  patched: ${subitemUpdates.length}`);

console.log('\n✅ Complete:');
console.log(`  +items patches=${itemUpdates.length}  +subitems patches=${subitemUpdates.length}`);
