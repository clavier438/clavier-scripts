#!/usr/bin/env node
// mukayu-restructure.mjs — 위계 vs facet 재구성
// 1) subitems.tags field 추가
// 2) 요리 정리 (요리 예시 4 + 디너 업그레이드 3 → deleteMe!, 1 남김)
// 3) 스파 위계 재구성 (17 평등 → 3 카테고리 + 17 subitems)

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
  items:    'tblIrbig24H0axx5h',
  subitems: 'tblH7xgPQDp6Df5dV',
  tags:     'tblH0N7YFH9xZ72Zk',
  section:  'tblKy64yavSnr5WPG',
};
const F = {
  items:    { name: 'fldQsGF8KULDI2Xdr', section: 'fldOHZZe3m76HbSfh',
              subitems: 'fldBaKyONlWooW3j0', tags: 'fldpurAPI52CI1ZFK' },
  subitems: { name: 'fldtj8Z90Fr8XlEWE', items: 'fldnbrtaAnZ0btTW6' },
  tags:     { name: 'fldDDwXKmxMWeE1U4' },
  section:  { filterMode: 'fldz7uqROiBNZfFf9', tags: 'fldrBmm7QwdZZzop9' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, body) {
  const r = await fetch(`https://api.airtable.com${path}`, {
    method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}

async function listBy(tbl, slugs) {
  const f = `OR(${slugs.map(s => `{slug}='${s.replace(/'/g, "\\'")}'`).join(',')})`;
  const r = await api('GET', `/v0/${BASE}/${tbl}?filterByFormula=${encodeURIComponent(f)}&pageSize=100`);
  const map = {};
  r.records.forEach(rec => {
    if (!map[rec.fields.slug]) map[rec.fields.slug] = [];
    map[rec.fields.slug].push(rec.id);
  });
  return map;
}

async function batchPost(tbl, recs) {
  const out = [];
  for (let i = 0; i < recs.length; i += 10) {
    const r = await api('POST', `/v0/${BASE}/${tbl}`,
      { records: recs.slice(i, i + 10).map(f => ({ fields: f })), typecast: true });
    out.push(...r.records);
    if (i + 10 < recs.length) await sleep(220);
  }
  return out;
}
async function batchPatch(tbl, ups) {
  const out = [];
  for (let i = 0; i < ups.length; i += 10) {
    const r = await api('PATCH', `/v0/${BASE}/${tbl}`,
      { records: ups.slice(i, i + 10), typecast: true });
    out.push(...r.records);
    if (i + 10 < ups.length) await sleep(220);
  }
  return out;
}

// ─── Phase 1: subitems.tags field 추가 ─────────
console.log('[1/3] subitems.tags field 추가 (multipleRecordLinks)...');
let subitemsTagsId;
try {
  const r = await api('POST', `/v0/meta/bases/${BASE}/tables/${T.subitems}/fields`, {
    name: 'tags', type: 'multipleRecordLinks',
    options: { linkedTableId: T.tags },
  });
  subitemsTagsId = r.id;
  console.log(`  ✅ field id=${subitemsTagsId}`);
} catch (e) {
  if (e.message.includes('DUPLICATE') || e.message.includes('FIELD_NAME')) {
    const meta = await api('GET', `/v0/meta/bases/${BASE}/tables`);
    const sub = meta.tables.find(t => t.id === T.subitems);
    subitemsTagsId = sub.fields.find(f => f.name === 'tags').id;
    console.log(`  이미 존재 (id=${subitemsTagsId})`);
  } else throw e;
}
await sleep(220);

// ─── Phase 2: 요리 정리 ─────────────────────────
console.log('\n[2/3] 요리 정리 — 요리 예시 4 + 디너 업그레이드 3 → deleteMe!');
// 요리-list 의 모든 items dump
const allCuisine = await api('GET',
  `/v0/${BASE}/${T.items}?filterByFormula=${encodeURIComponent('FIND("요리-list",{slug})')}` +
  `&fields%5B%5D=slug&fields%5B%5D=name&pageSize=100`);

const cuisineExamples = allCuisine.records.filter(r => r.fields.name === '요리 예시');
const cuisineDinners = allCuisine.records.filter(r => r.fields.name === '디너 업그레이드 (연중 가능)');
console.log(`  요리 예시: ${cuisineExamples.length}, 디너 업그레이드: ${cuisineDinners.length}`);

// 요리 예시 4개 모두 deleteMe!
const renameTargets = [
  ...cuisineExamples.map(r => ({ id: r.id, fields: { [F.items.name]: 'deleteMe!_요리 예시' } })),
  // 디너 업그레이드 4개 중 첫 1개만 남기고 3개 deleteMe!
  ...cuisineDinners.slice(1).map(r => ({ id: r.id, fields: { [F.items.name]: 'deleteMe!_디너 업그레이드 (연중 가능)' } })),
];
const keepDinnerId = cuisineDinners[0]?.id;
console.log(`  남기는 dinner upgrade id: ${keepDinnerId}`);

await batchPatch(T.items, renameTargets);
console.log(`  ✅ ${renameTargets.length} items rename`);
await sleep(220);

// 디너 subitems 3 의 items link → 남은 1개 dinner upgrade item 만
console.log('  dinner subitems items link 정리...');
const dinnerSubs = await api('GET',
  `/v0/${BASE}/${T.subitems}?filterByFormula=${encodeURIComponent(
    `OR({name}="가나자와 스시 가이세키",{name}="고기 코스",{name}="베지테리언 코스")`)}` +
  `&fields%5B%5D=name&pageSize=100`);
const dinnerSubUpdates = dinnerSubs.records.map(r => ({
  id: r.id, fields: { [F.subitems.items]: [keepDinnerId] },
}));
await batchPatch(T.subitems, dinnerSubUpdates);
console.log(`  ✅ ${dinnerSubUpdates.length} subitems link 정리`);
await sleep(220);

// ─── Phase 3: 스파 위계 재구성 ──────────────────
console.log('\n[3/3] 스파 위계 재구성...');

// 3.1 — 3 카테고리 items name 복원
console.log('  3.1) deleteMe!_메뉴 카테고리 3 items name 복원...');
const oldMenus = await api('GET',
  `/v0/${BASE}/${T.items}?filterByFormula=${encodeURIComponent('FIND("deleteMe!_메뉴",{name})')}` +
  `&fields%5B%5D=slug&fields%5B%5D=name&pageSize=100`);

const restored = oldMenus.records.map(r => ({
  id: r.id, fields: { [F.items.name]: r.fields.name.replace(/^deleteMe!_/, '') },
}));
await batchPatch(T.items, restored);
const yakushiId  = restored.find((r,i) => oldMenus.records[i].fields.name.includes('야쿠시야마'))?.id;
const optionId   = restored.find((r,i) => oldMenus.records[i].fields.name.includes('옵션'))?.id;
const otherId    = restored.find((r,i) => oldMenus.records[i].fields.name.includes('기타'))?.id;
console.log(`     ✅ 야쿠시야마=${yakushiId} 옵션=${optionId} 기타=${otherId}`);
await sleep(220);

// 3.2 — 새 subitems 17 atCreate
console.log('  3.2) 새 subitems 17 atCreate...');
const SPA_SUBITEMS = [
  // 야쿠시야마 (3)
  { name: '바디 트리트먼트',           parent: yakushiId, season: null },
  { name: '페이셜 트리트먼트',         parent: yakushiId, season: null },
  { name: '바디 & 페이셜 콤비네이션', parent: yakushiId, season: null },
  // 기타 (10)
  { name: '봄 사쿠라 바디 트리트먼트',           parent: otherId,   season: 'season-봄' },
  { name: '여름 무더위 해소 트리트먼트',         parent: otherId,   season: 'season-여름' },
  { name: '다마스크 로즈 애프터선 리커버리',     parent: otherId,   season: 'season-여름' },
  { name: '가을 향올리브 바디 트리트먼트',       parent: otherId,   season: 'season-가을' },
  { name: '겨울 유자 바디 트리트먼트',           parent: otherId,   season: 'season-겨울' },
  { name: '시차 회복 트리트먼트',                 parent: otherId,   season: null },
  { name: '근육 테라피 바디 트리트먼트',         parent: otherId,   season: null },
  { name: '아로마테라피 바디 트리트먼트',         parent: otherId,   season: null },
  { name: '일본식 지압 마사지',                   parent: otherId,   season: null },
  { name: '야쿠시야마 임산부 트리트먼트',         parent: otherId,   season: null },
  // 옵션 (4)
  { name: '복부 트리트먼트',                       parent: optionId,  season: null },
  { name: 'IOU 스톤 아이필로우 헤드 마사지',     parent: optionId,  season: null },
  { name: '리플렉솔로지 발 마사지',                parent: optionId,  season: null },
  { name: '익스프레스 페이셜 트리트먼트',         parent: optionId,  season: null },
];

// 시즌 tags ID 확보
const seasonMap = await listBy(T.tags, ['season-봄', 'season-여름', 'season-가을', 'season-겨울']);
const seasonId = name => seasonMap[name]?.[0];

const newSubs = SPA_SUBITEMS.map(s => ({
  [F.subitems.name]:  s.name,
  [F.subitems.items]: [s.parent],
  ...(s.season ? { [subitemsTagsId]: [seasonId(s.season)] } : {}),
}));
const newSubsRes = await batchPost(T.subitems, newSubs);
console.log(`     ✅ ${newSubsRes.length} subitems atCreate`);
await sleep(220);

// 3.4 — 17 기존 spa items → deleteMe!
console.log('  3.4) 17 기존 spa items → deleteMe!_...');
const oldSpaItems = await api('GET',
  `/v0/${BASE}/${T.items}?filterByFormula=${encodeURIComponent(
    'AND(FIND("스파-list",{slug}),NOT(FIND("메뉴",{name})))')}` +
  `&fields%5B%5D=slug&fields%5B%5D=name&pageSize=100`);

const oldSpaUpdates = oldSpaItems.records.map(r => ({
  id: r.id, fields: { [F.items.name]: 'deleteMe!_' + r.fields.name },
}));
await batchPatch(T.items, oldSpaUpdates);
console.log(`     ✅ ${oldSpaUpdates.length} items deleteMe!_`);
await sleep(220);

// 3.5 — spa-menu 3 tags → deleteMe!
console.log('  3.5) spa-menu 3 tags → deleteMe!_...');
const spaMenuTags = await listBy(T.tags, ['spa-menu-야쿠시야마', 'spa-menu-기타', 'spa-menu-옵션']);
const tagUpdates = Object.entries(spaMenuTags).map(([slug, ids]) => ({
  id: ids[0],
  fields: { [F.tags.name]: 'deleteMe!_' + slug.replace('spa-menu-', '') },
}));
await batchPatch(T.tags, tagUpdates);
console.log(`     ✅ ${tagUpdates.length} tags deleteMe!_`);
await sleep(220);

// 3.6 — 스파-list section: filterMode='none', tags=[]
console.log('  3.6) 스파-list section PATCH (filterMode=none, tags=[])...');
const spaListSection = await listBy(T.section, ['스파-list']);
await api('PATCH', `/v0/${BASE}/${T.section}`, {
  records: [{
    id: spaListSection['스파-list'][0],
    fields: { [F.section.filterMode]: 'none', [F.section.tags]: [] },
  }],
  typecast: true,
});
console.log('     ✅');

console.log('\n✅ Restructure 완료');
console.log(`  +subitems field=tags`);
console.log(`  요리: ${renameTargets.length} rename + ${dinnerSubUpdates.length} subitems link`);
console.log(`  스파: 3 메뉴 복원 + ${newSubsRes.length} 새 subitems + ${oldSpaUpdates.length} items deleteMe + ${tagUpdates.length} tags deleteMe + 1 section PATCH`);
