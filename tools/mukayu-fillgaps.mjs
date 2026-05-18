#!/usr/bin/env node
// mukayu-fillgaps.mjs — 9.0.0 → 9.0.1 빠진 부분 채움
// 빠진 navigation 페이지 (오퍼/소식/오시는길) + 푸터 items
// 합계: tags 5 + pages 3 + sections 9 + items 16 = 33 records

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// table & field ids
const T = {
  pages:    'tblUNBy8USlFqaVWN',
  section:  'tblKy64yavSnr5WPG',
  tags:     'tblH0N7YFH9xZ72Zk',
  items:    'tblIrbig24H0axx5h',
};
const F = {
  pages: { name: 'fldrYODj09oJpQvGa', kind: 'fld1BgtUGY0pc29zI' },
  section: {
    role: 'fldILF1GvQJweWQPd', name: 'fldSzBrqSlW0ZAmXQ', subName: 'fldfgKUt0PZZsEcYv',
    notes: 'fldxCLS4Qy08N33R1', tags: 'fldrBmm7QwdZZzop9', filterMode: 'fldz7uqROiBNZfFf9',
    layout: 'fldiaPS5GhwmM2DMV', page: 'fldHRGctN7IIV1wyF', items: 'fldvDnbOrdSciKQIF',
  },
  tags: { name: 'fldDDwXKmxMWeE1U4', group: 'fldgMbNzB2ragRyLP' },
  items: {
    section: 'fldOHZZe3m76HbSfh', name: 'fldQsGF8KULDI2Xdr', subName: 'fldd9P8bSoOCb6Ne6',
    layout: 'fldg3U6NyQlZvue2w',
    caption: 'fldB4gT5wHfIjEIy6', ctaText: 'fldqqfHwYdUcwJNii', ctaUrl: 'fldViPuqLJkZqrxyM',
    tags: 'fldpurAPI52CI1ZFK',
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(tbl, recs) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ records: recs.map(f => ({ fields: f })), typecast: true }),
  });
  if (!r.ok) throw new Error(`POST ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}

async function patch(tbl, ups) {
  if (!ups.length) return [];
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ records: ups, typecast: true }),
  });
  if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}

async function batchPost(tbl, recs) {
  const out = [];
  for (let i = 0; i < recs.length; i += 10) {
    out.push(...await post(tbl, recs.slice(i, i + 10)));
    if (i + 10 < recs.length) await sleep(220);
  }
  return out;
}

async function fetchBySlug(tbl, slugs) {
  const formula = `OR(${slugs.map(s => `{slug}='${s.replace(/'/g, "\\'")}'`).join(',')})`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}?filterByFormula=${encodeURIComponent(formula)}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${tbl}: ${r.status}`);
  const map = {};
  (await r.json()).records.forEach(rec => { map[rec.fields.slug] = rec.id; });
  return map;
}

// ─── 1. tags ─────────────────────────────────────────
console.log('[1/5] tags create (5)...');
const TAGS = [
  { name: '시즌 추천', group: 'offer' },
  { name: '장기 숙박', group: 'offer' },
  { name: '웰니스',    group: 'offer' },
  { name: '특별한 날', group: 'offer' },
  { name: '단체 전세', group: 'offer' },
];
const tagsRes = await post(T.tags, TAGS.map(t => ({
  [F.tags.name]: t.name, [F.tags.group]: t.group,
})));
const tagsMap = {};
tagsRes.forEach(r => { tagsMap[r.fields.slug] = r.id; });
console.log('  ', Object.keys(tagsMap));
await sleep(220);

// ─── 2. pages ────────────────────────────────────────
console.log('[2/5] pages create (3)...');
const PAGES = [
  { name: '오퍼',     kind: 'content' },
  { name: '소식',     kind: 'content' },
  { name: '오시는길', kind: 'content' },
];
const pagesRes = await post(T.pages, PAGES.map(p => ({
  [F.pages.name]: p.name, [F.pages.kind]: p.kind,
})));
const pagesMap = {};
pagesRes.forEach(r => { pagesMap[r.fields.slug] = r.id; });
console.log('  ', Object.keys(pagesMap));
await sleep(220);

// ─── 3. sections (page link 포함) ─────────────────────
console.log('[3/5] sections create (9)...');
const SECTIONS = [
  { page: '오퍼',     role: 'intro', name: '머묾의 방식',  layout: 'p' },
  { page: '오퍼',     role: 'list',  name: '오퍼 목록',    layout: 'p', filterMode: 'tab' },
  { page: '오퍼',     role: 'info',  name: '예약 안내',    layout: 'p' },
  { page: '소식',     role: 'intro', name: '새로운 이야기', layout: 'p' },
  { page: '소식',     role: 'list',  name: '소식·행사',    layout: 'p' },
  { page: '소식',     role: 'info',  name: '정기 소식 받기', layout: 'p' },
  { page: '오시는길', role: 'intro', name: '도착의 여정',   layout: 'p' },
  { page: '오시는길', role: 'list',  name: '교통편',       layout: 'p' },
  { page: '오시는길', role: 'info',  name: '위치·주소',    layout: 'p' },
];
const sectionsRes = await post(T.section, SECTIONS.map(s => ({
  [F.section.role]: s.role,
  [F.section.name]: s.name,
  [F.section.layout]: s.layout,
  [F.section.page]: [pagesMap[s.page]],
  ...(s.filterMode ? { [F.section.filterMode]: s.filterMode } : {}),
})));
const sectionsMap = {};
sectionsRes.forEach(r => { sectionsMap[r.fields.slug] = r.id; });
console.log('  ', Object.keys(sectionsMap));
await sleep(220);

// brand-footer 기존 section id 확보
console.log('  brand-footer fetch...');
const existing = await fetchBySlug(T.section, ['brand-footer']);
const brandFooterId = existing['brand-footer'];
if (!brandFooterId) throw new Error('brand-footer section not found');
console.log('  brand-footer id:', brandFooterId);
await sleep(220);

// ─── 4. items (section + tags link 포함) ──────────────
console.log('[4/5] items create (16)...');
const ITEMS = [
  // 오퍼 — 5 패키지, 각 1 tag
  { section: '오퍼-list',     name: '1인 특별 플랜',           subName: '혼자만의 시간을 위한 단독 패키지',     tags: ['offer-시즌'] },
  { section: '오퍼-list',     name: '2박 혜택 숙박',           subName: '2박 이상 머무는 손님을 위한 추가 혜택', tags: ['offer-장기'] },
  { section: '오퍼-list',     name: '야쿠시야마 웰니스 리트릿', subName: '대지와 연결되는 그라운딩 리트릿',     tags: ['offer-웰니스'] },
  { section: '오퍼-list',     name: '특별한 행사',             subName: '기념일을 위한 맞춤 제안',           tags: ['offer-특별'] },
  { section: '오퍼-list',     name: '오모테나시 여정',         subName: '세계에서 카가까지의 환대',           tags: ['offer-전세'] },
  // 소식 — 1 placeholder
  { section: '소식-list',     name: '게시 준비 중' },
  // 오시는길 — 3 교통편
  { section: '오시는길-list', name: '기차' },
  { section: '오시는길-list', name: '비행기' },
  { section: '오시는길-list', name: '자동차' },
  // 푸터 — 7, brand-footer 에 link
  { sectionId: brandFooterId, name: '이시카와현 카가시 야마시로 온센 55-1-3', caption: '주소' },
  { sectionId: brandFooterId, name: '+81-(0)761-77-1340',     caption: '전화',        ctaUrl: 'tel:+81761771340' },
  { sectionId: brandFooterId, name: 'beniya@mukayu.com',      caption: '이메일',      ctaUrl: 'mailto:beniya@mukayu.com' },
  { sectionId: brandFooterId, name: '지도 보기',              caption: 'Google Map',  ctaUrl: 'https://goo.gl/maps/MnFjxQjdAGcWupCU7' },
  { sectionId: brandFooterId, name: '온라인 숍',              caption: 'ONLINE SHOP', ctaUrl: 'http://mukayu.ocnk.net/' },
  { sectionId: brandFooterId, name: '채용 안내',              caption: 'CAREERS',     ctaUrl: 'https://careers.smartrecruiters.com/RelaisChateaux/beniya-mukayu' },
  { sectionId: brandFooterId, name: '© 2026 BENIYA MUKAYU All rights reserved', caption: '저작권' },
];

const itemsRes = await batchPost(T.items, ITEMS.map(i => {
  const sec = i.sectionId || sectionsMap[i.section];
  if (!sec) throw new Error(`No section for item: ${i.name}`);
  const tagIds = (i.tags || []).map(s => tagsMap[s]).filter(Boolean);
  return {
    [F.items.name]: i.name,
    ...(i.subName ? { [F.items.subName]: i.subName } : {}),
    ...(i.caption ? { [F.items.caption]: i.caption } : {}),
    ...(i.ctaUrl  ? { [F.items.ctaUrl]:  i.ctaUrl }  : {}),
    [F.items.section]: [sec],
    ...(tagIds.length ? { [F.items.tags]: tagIds } : {}),
  };
}));
console.log(`  items: ${itemsRes.length}`);
await sleep(220);

// ─── 5. 오퍼-list section 에 5 tags link ───────────────
console.log('[5/5] sections.tags link (오퍼-list ↔ 5 offer tags)...');
await patch(T.section, [{
  id: sectionsMap['오퍼-list'],
  fields: { [F.section.tags]: Object.values(tagsMap) },
}]);

console.log('\n✅ Complete:');
console.log(`  tags=${Object.keys(tagsMap).length}  pages=${Object.keys(pagesMap).length}  sections=${Object.keys(sectionsMap).length}  items=${itemsRes.length}`);
console.log(`  total = ${Object.keys(tagsMap).length + Object.keys(pagesMap).length + Object.keys(sectionsMap).length + itemsRes.length} records`);
