#!/usr/bin/env node
// mukayu-fillgaps2.mjs — 사용자 스크린샷 기반 추가 데이터
// News·Events 5 카테고리 + brand-awards section + Awards/디자이너/MICHELIN

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
  pages:    'tblUNBy8USlFqaVWN',
  section:  'tblKy64yavSnr5WPG',
  tags:     'tblH0N7YFH9xZ72Zk',
  items:    'tblIrbig24H0axx5h',
};
const F = {
  pages:   { name: 'fldrYODj09oJpQvGa', kind: 'fld1BgtUGY0pc29zI' },
  section: { role: 'fldILF1GvQJweWQPd', name: 'fldSzBrqSlW0ZAmXQ', layout: 'fldiaPS5GhwmM2DMV',
             page: 'fldHRGctN7IIV1wyF', tags: 'fldrBmm7QwdZZzop9', filterMode: 'fldz7uqROiBNZfFf9' },
  tags:    { name: 'fldDDwXKmxMWeE1U4', group: 'fldgMbNzB2ragRyLP' },
  items:   { name: 'fldQsGF8KULDI2Xdr', subName: 'fldd9P8bSoOCb6Ne6', section: 'fldOHZZe3m76HbSfh',
             caption: 'fldB4gT5wHfIjEIy6', tags: 'fldpurAPI52CI1ZFK', notes: 'fldvvQ6MI7PLwvE7C' },
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
  if (!ups.length) return [];
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

// ─── 1. news tags (5) ─────────────────────────────
console.log('[1/6] news tags (5)...');
const NEWS_TAGS = [
  { name: '뉴스',   group: 'news' },
  { name: '행사',   group: 'news' },
  { name: '보도자료', group: 'news' },
  { name: 'Relais & Chateaux', group: 'news' },
  { name: '단독 혜택', group: 'news' },
];
const newsTagsRes = await post(T.tags, NEWS_TAGS.map(t => ({
  [F.tags.name]: t.name, [F.tags.group]: t.group,
})));
const newsTagsMap = {};
newsTagsRes.forEach(r => { newsTagsMap[r.fields.slug] = r.id; });
console.log('  ', Object.keys(newsTagsMap));
await sleep(220);

// ─── 2. brand-awards section ────────────────────
console.log('[2/6] brand-awards section...');
const brandMap = await listBy(T.pages, ['brand']);
const brandId = brandMap['brand'];
if (!brandId) throw new Error('brand page not found');

const sectionRes = await post(T.section, [{
  [F.section.role]:   'info',
  [F.section.name]:   '수상 내역',
  [F.section.layout]: 'p',
  [F.section.page]:   [brandId],
}]);
const brandAwardsId = sectionRes[0].id;
const brandAwardsSlug = sectionRes[0].fields.slug;
console.log('  brand-awards slug:', brandAwardsSlug, 'id:', brandAwardsId);
await sleep(220);

// ─── 3. brand-footer + 소식-list 기존 ID 확보 ──────
console.log('[3/6] 기존 section IDs...');
const existing = await listBy(T.section, ['brand-footer', '소식-list']);
const brandFooterId = existing['brand-footer'];
const newsListId = existing['소식-list'];
console.log('  brand-footer:', brandFooterId, '소식-list:', newsListId);
await sleep(220);

// ─── 4. items (6) ─────────────────────────────
console.log('[4/6] items (6)...');
const ITEMS = [
  // brand-awards 에 link (4 awards + MICHELIN)
  { sectionId: brandAwardsId, name: 'AUTHENTIC HOTELS & CRUISES WELCOME AWARD 2015', caption: '수상' },
  { sectionId: brandAwardsId, name: 'BEST SMALL HOTEL SPA WORLDWIDE 2015',           caption: '수상' },
  { sectionId: brandAwardsId, name: 'RELAIS & CHATEAUX Welcome Trophy 2013',         caption: '수상' },
  { sectionId: brandAwardsId, name: 'SPA JAPAN CRYSTAL AWARDS PROFESSIONAL 2012',    caption: '수상' },
  { sectionId: brandAwardsId, name: 'MICHELIN 2025',                                  caption: '인증' },
  // brand-footer 에 link (디자이너 크레딧)
  { sectionId: brandFooterId, name: 'AMORPHE / Kiyoshi Sey Takeyama',                 caption: '건축' },
];
const itemsRes = await batchPost(T.items, ITEMS.map(i => ({
  [F.items.name]:    i.name,
  ...(i.subName ? { [F.items.subName]: i.subName } : {}),
  ...(i.caption ? { [F.items.caption]: i.caption } : {}),
  [F.items.section]: [i.sectionId],
})));
console.log(`  items: ${itemsRes.length}`);
await sleep(220);

// ─── 5. 소식-list section PATCH (filterMode + tags) ─
console.log('[5/6] 소식-list filterMode + tags link...');
await patch(T.section, [{
  id: newsListId,
  fields: {
    [F.section.filterMode]: 'checkbox',
    [F.section.tags]:       Object.values(newsTagsMap),
  },
}]);
console.log('  filterMode=checkbox, 5 tags linked');
await sleep(220);

// ─── 6. 소식-list-게시-준비-중 placeholder PATCH ─────
console.log('[6/6] news placeholder → 실제 게시물 PATCH...');
const placeholder = await listBy(T.items, ['소식-list-게시-준비-중']);
const placeholderId = placeholder['소식-list-게시-준비-중'];
if (placeholderId) {
  await patch(T.items, [{
    id: placeholderId,
    fields: {
      [F.items.name]:    'Scott Haas Goes To Meet Sachiko Nakamichi',
      [F.items.subName]: 'The Japanese Way of Acceptance',
      [F.items.tags]:    [newsTagsMap['news-보도자료']],
    },
  }]);
  console.log('  placeholder 갱신 완료');
} else {
  console.log('  placeholder not found (skip)');
}

console.log('\n✅ Complete:');
console.log(`  +tags=${Object.keys(newsTagsMap).length}  +sections=1  +items=${itemsRes.length}  patches=2`);
