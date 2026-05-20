#!/usr/bin/env node
// mukayu-fillgaps4.mjs — C 안: 일관 패턴으로 누락 분 추가
// spa 17 + cuisine 시즌 매핑 + dinner subitems 3 + 객실-info 2 + 예약 신규
// + spa-menu tags 3 + 기존 spa 3 items deleteMe! 마킹

import "./lib/freshness.mjs"

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
  pages:    'tblUNBy8USlFqaVWN',
  section:  'tblKy64yavSnr5WPG',
  tags:     'tblH0N7YFH9xZ72Zk',
  items:    'tblIrbig24H0axx5h',
  subitems: 'tblH7xgPQDp6Df5dV',
};
const F = {
  pages:    { name: 'fldrYODj09oJpQvGa', kind: 'fld1BgtUGY0pc29zI' },
  section:  { role: 'fldILF1GvQJweWQPd', name: 'fldSzBrqSlW0ZAmXQ', layout: 'fldiaPS5GhwmM2DMV',
              page: 'fldHRGctN7IIV1wyF', tags: 'fldrBmm7QwdZZzop9', filterMode: 'fldz7uqROiBNZfFf9',
              items: 'fldvDnbOrdSciKQIF' },
  tags:     { name: 'fldDDwXKmxMWeE1U4', group: 'fldgMbNzB2ragRyLP' },
  items:    { name: 'fldQsGF8KULDI2Xdr', subName: 'fldd9P8bSoOCb6Ne6', section: 'fldOHZZe3m76HbSfh',
              caption: 'fldB4gT5wHfIjEIy6', tags: 'fldpurAPI52CI1ZFK',
              subitems: 'fldBaKyONlWooW3j0' },
  subitems: { name: 'fldtj8Z90Fr8XlEWE', items: 'fldnbrtaAnZ0btTW6' },
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
  if (!slugs.length) return {};
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
async function batchPatch(tbl, ups) {
  const out = [];
  for (let i = 0; i < ups.length; i += 10) {
    out.push(...await patch(tbl, ups.slice(i, i + 10)));
    if (i + 10 < ups.length) await sleep(220);
  }
  return out;
}

// ─── 1. spa-menu tags 3 ──────────────────────────
console.log('[1/9] spa-menu tags (3)...');
const spaMenuRes = await post(T.tags, [
  { [F.tags.name]: '야쿠시야마', [F.tags.group]: 'spa-menu' },
  { [F.tags.name]: '기타',       [F.tags.group]: 'spa-menu' },
  { [F.tags.name]: '옵션',       [F.tags.group]: 'spa-menu' },
]);
const spaMenuMap = {};
spaMenuRes.forEach(r => { spaMenuMap[r.fields.slug] = r.id; });
console.log('  ', Object.keys(spaMenuMap));
await sleep(220);

// ─── 2. season tags + 스파-list section ID ─────────
console.log('[2/9] 기존 ID 확보...');
const seasonMap = await listBy(T.tags, ['season-봄', 'season-여름', 'season-가을', 'season-겨울']);
const sections = await listBy(T.section, ['스파-list', '요리-list', '객실-info']);
console.log('  season:', Object.keys(seasonMap).length, 'sections:', Object.keys(sections).length);
await sleep(220);

// ─── 3. spa items 17 신규 ─────────────────────────
console.log('[3/9] spa items 17 신규...');
const SPA_ITEMS = [
  // 야쿠시야마 (3)
  { name: '야쿠시야마 바디 트리트먼트',           tags: ['spa-menu-야쿠시야마'] },
  { name: '야쿠시야마 페이셜 트리트먼트',         tags: ['spa-menu-야쿠시야마'] },
  { name: '야쿠시야마 바디 & 페이셜 콤비네이션', tags: ['spa-menu-야쿠시야마'] },
  // 기타 — 시즌 (5)
  { name: '봄 사쿠라 바디 트리트먼트',           tags: ['spa-menu-기타', 'season-봄'] },
  { name: '여름 무더위 해소 트리트먼트',         tags: ['spa-menu-기타', 'season-여름'] },
  { name: '다마스크 로즈 애프터선 리커버리',     tags: ['spa-menu-기타', 'season-여름'] },
  { name: '가을 향올리브 바디 트리트먼트',       tags: ['spa-menu-기타', 'season-가을'] },
  { name: '겨울 유자 바디 트리트먼트',           tags: ['spa-menu-기타', 'season-겨울'] },
  // 기타 — 일반 (5)
  { name: '시차 회복 트리트먼트',                 tags: ['spa-menu-기타'] },
  { name: '근육 테라피 바디 트리트먼트',         tags: ['spa-menu-기타'] },
  { name: '아로마테라피 바디 트리트먼트',         tags: ['spa-menu-기타'] },
  { name: '일본식 지압 마사지',                   tags: ['spa-menu-기타'] },
  { name: '야쿠시야마 임산부 트리트먼트',         tags: ['spa-menu-기타'] },
  // 옵션 (4)
  { name: '복부 트리트먼트',                       tags: ['spa-menu-옵션'] },
  { name: 'IOU 스톤 아이필로우 헤드 마사지',     tags: ['spa-menu-옵션'] },
  { name: '리플렉솔로지 발 마사지',                tags: ['spa-menu-옵션'] },
  { name: '익스프레스 페이셜 트리트먼트',         tags: ['spa-menu-옵션'] },
];
const allTagMap = { ...spaMenuMap, ...seasonMap };
const spaItemsRes = await batchPost(T.items, SPA_ITEMS.map(i => ({
  [F.items.name]:    i.name,
  [F.items.section]: [sections['스파-list']],
  [F.items.tags]:    i.tags.map(t => allTagMap[t]).filter(Boolean),
})));
console.log(`  spa items: ${spaItemsRes.length}`);
await sleep(220);

// ─── 4. 스파-list section PATCH ──────────────────
console.log('[4/9] 스파-list section PATCH (filterMode + tags)...');
await patch(T.section, [{
  id: sections['스파-list'],
  fields: {
    [F.section.filterMode]: 'tab',
    [F.section.tags]:       Object.values(spaMenuMap),
  },
}]);
console.log('  filterMode=tab, 3 spa-menu tags linked');
await sleep(220);

// ─── 5. 기존 spa items 3 deleteMe! 마킹 ──────────
console.log('[5/9] 기존 "메뉴 |..." items deleteMe! 마킹...');
const oldSpaSlugs = ['스파-list-메뉴-|-야쿠시야마-트리트먼트', '스파-list-메뉴-|-옵션-메뉴', '스파-list-메뉴-|-기타'];
const oldSpaMap = await listBy(T.items, oldSpaSlugs);
console.log('  found:', Object.keys(oldSpaMap));
const oldSpaUpdates = Object.entries(oldSpaMap).map(([slug, id]) => {
  const m = slug.match(/^스파-list-메뉴-\|-(.+)$/);
  return { id, fields: { [F.items.name]: `deleteMe!_메뉴 | ${m ? m[1].replace(/-/g, ' ') : 'old'}` } };
});
if (oldSpaUpdates.length) await patch(T.items, oldSpaUpdates);
await sleep(220);

// ─── 6. cuisine items 시즌 tag 매핑 PATCH ────────
console.log('[6/9] cuisine items 시즌 매핑 PATCH...');
const CUISINE_SEASON = [
  { slug: '요리-list-햇-죽순-코스',         season: 'season-봄' },
  { slug: '요리-list-전복-스페셜-코스',     season: 'season-여름' },
  { slug: '요리-list-바위굴-코스',          season: 'season-여름' },
  { slug: '요리-list-마츠타케-코스',        season: 'season-가을' },
  { slug: '요리-list-대게-가이세키-코스',   season: 'season-겨울' },
  { slug: '요리-list-대게-풀코스',          season: 'season-겨울' },
];
const cuisineMap = await listBy(T.items, CUISINE_SEASON.map(c => c.slug));
console.log('  cuisine items found:', Object.keys(cuisineMap).length);
const cuisineUpdates = CUISINE_SEASON.map(c => {
  const id = cuisineMap[c.slug];
  if (!id || !seasonMap[c.season]) return null;
  return { id, fields: { [F.items.tags]: [seasonMap[c.season]] } };
}).filter(Boolean);
await batchPatch(T.items, cuisineUpdates);
console.log(`  patched: ${cuisineUpdates.length}`);
await sleep(220);

// ─── 7. 요리-list section PATCH ──────────────────
console.log('[7/9] 요리-list section PATCH...');
await patch(T.section, [{
  id: sections['요리-list'],
  fields: {
    [F.section.filterMode]: 'tab',
    [F.section.tags]:       Object.values(seasonMap),
  },
}]);
await sleep(220);

// ─── 8. cuisine dinner subitems 3 신규 ───────────
console.log('[8/9] cuisine dinner subitems (3)...');
// "디너 업그레이드 (연중 가능)" items 4개 모두 fetch (slug formula: 요리-list-디너-업그레이드-(연중-가능))
const allItems = await fetch(`https://api.airtable.com/v0/${BASE}/${T.items}?fields%5B%5D=slug&fields%5B%5D=name&pageSize=100`, { headers: H }).then(r => r.json());
const dinnerItemIds = allItems.records.filter(r => r.fields.name === '디너 업그레이드 (연중 가능)').map(r => r.id);
console.log('  dinner upgrade items found:', dinnerItemIds.length);
const subitemsRes = await post(T.subitems, [
  { [F.subitems.name]: 'Kanazawa 스시 가이세키', [F.subitems.items]: dinnerItemIds },
  { [F.subitems.name]: '고기 코스',               [F.subitems.items]: dinnerItemIds },
  { [F.subitems.name]: '베지테리언 코스',         [F.subitems.items]: dinnerItemIds },
]);
console.log(`  subitems: ${subitemsRes.length}`);
await sleep(220);

// ─── 9. 객실-info items 2 + reservation 신규 ─────
console.log('[9/9] 객실-info items 2 + 예약 페이지 신규...');
const roomInfoRes = await post(T.items, [
  { [F.items.name]: '시설 정보',           [F.items.caption]: '일반 안내', [F.items.section]: [sections['객실-info']] },
  { [F.items.name]: '어린이·단체 정책',    [F.items.caption]: '정책',     [F.items.section]: [sections['객실-info']] },
]);
console.log(`  객실-info items: ${roomInfoRes.length}`);
await sleep(220);

// 예약 페이지 + sections + items
const pagesRes = await post(T.pages, [{ [F.pages.name]: '예약', [F.pages.kind]: 'content' }]);
const reservationPageId = pagesRes[0].id;
await sleep(220);

const resvSecRes = await post(T.section, [
  { [F.section.role]: 'intro', [F.section.name]: '예약 안내',  [F.section.layout]: 'p', [F.section.page]: [reservationPageId] },
  { [F.section.role]: 'list',  [F.section.name]: '이용 정책',  [F.section.layout]: 'p', [F.section.page]: [reservationPageId] },
  { [F.section.role]: 'info',  [F.section.name]: '연락·예약', [F.section.layout]: 'p', [F.section.page]: [reservationPageId] },
]);
const resvListId = resvSecRes.find(r => r.fields.slug === '예약-list').id;
await sleep(220);

const resvItemsRes = await batchPost(T.items, [
  { [F.items.name]: '안내 사항',     [F.items.caption]: 'Kindly note',     [F.items.section]: [resvListId] },
  { [F.items.name]: '어린이 정책',   [F.items.caption]: 'Children Policy', [F.items.section]: [resvListId] },
  { [F.items.name]: '단체 정책',     [F.items.caption]: 'Group Policy',    [F.items.section]: [resvListId] },
  { [F.items.name]: '취소 정책',     [F.items.caption]: 'Cancellation',    [F.items.section]: [resvListId] },
]);
console.log(`  예약 page=1, sections=${resvSecRes.length}, items=${resvItemsRes.length}`);

console.log('\n✅ Complete!');
console.log(`  +tags=3  +items=${spaItemsRes.length + roomInfoRes.length + resvItemsRes.length}  +subitems=${subitemsRes.length}  +pages=1  +sections=${resvSecRes.length}`);
console.log(`  PATCH: cuisine=${cuisineUpdates.length}  spa-old=${oldSpaUpdates.length}  spa-list=1  요리-list=1`);
