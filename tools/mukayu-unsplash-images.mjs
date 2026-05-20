#!/usr/bin/env node
// mukayu-unsplash-images.mjs
// Unsplash API 로 카테고리별 료칸 톤 이미지 → items/sections 의 img/gallery PATCH (Picsum 덮어쓰기)

import "./lib/freshness.mjs"

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
const UNSPLASH = process.env.UNSPLASH_ACCESS_KEY;
if (!TOKEN || !UNSPLASH) throw new Error('AIRTABLE_PAT or UNSPLASH_ACCESS_KEY not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { items: 'tblIrbig24H0axx5h', section: 'tblKy64yavSnr5WPG' };

// 카테고리 → Unsplash 키워드 (mukayu 료칸 톤: wabi-sabi · minimal · natural · 어두운 나무 · 이끼)
// 키워드 길면 결과 부족 — 핵심 단어 3-4개로
const KEYWORD_MAP = {
  rooms:       'japanese tatami room',
  facilities:  'japanese ryokan interior',
  cuisine:     'kaiseki japanese cuisine',
  spa:         'onsen japanese spring',
  amenities:   'natural bath amenity',
  experience:  'tea ceremony japan',
  offer:       'japanese ryokan luxury',
  news:        'japan landscape mountain',
  access:      'japan forest path',
  reservation: 'japanese hotel lobby',
  brand:       'japanese zen garden',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function categoryOf(slug) {
  if (slug.startsWith('객실')) return 'rooms';
  if (slug.startsWith('시설')) return 'facilities';
  if (slug.startsWith('요리')) return 'cuisine';
  if (slug.startsWith('스파')) return 'spa';
  if (slug.startsWith('어메니티')) return 'amenities';
  if (slug.startsWith('체험')) return 'experience';
  if (slug.startsWith('오퍼')) return 'offer';
  if (slug.startsWith('소식')) return 'news';
  if (slug.startsWith('오시는길')) return 'access';
  if (slug.startsWith('예약')) return 'reservation';
  return 'brand';
}

async function unsplashSearch(query, perPage = 20) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape&client_id=${UNSPLASH}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Unsplash ${query}: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.results.map(p => ({ url: p.urls.regular, by: p.user.name }));
}

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
    await sleep(400);
  }
  console.log();
}

// ─── 1) Unsplash 카테고리별 검색 (cache) ───────────
console.log('[1/3] Unsplash search per category...');
const photoCache = {};
for (const [cat, query] of Object.entries(KEYWORD_MAP)) {
  photoCache[cat] = await unsplashSearch(query, 20);
  console.log(`  ${cat}: "${query}" → ${photoCache[cat].length} photos`);
  await sleep(300);
}

// ─── 2) items 카테고리별 dump + PATCH ─────────────
console.log('\n[2/3] items dump + PATCH (img + gallery)...');
const items = await dumpAll(T.items, ['slug']);
const itemsByCat = {};
for (const r of items) {
  const cat = categoryOf(r.fields.slug || '');
  (itemsByCat[cat] = itemsByCat[cat] || []).push(r);
}
const itemUpdates = [];
for (const [cat, recs] of Object.entries(itemsByCat)) {
  // photos 5장 미만이면 brand 톤 fallback (다양성 확보)
  const photos = (photoCache[cat]?.length >= 5) ? photoCache[cat] : photoCache.brand;
  if (!photos.length) continue;
  recs.forEach((r, i) => {
    itemUpdates.push({
      id: r.id,
      fields: {
        img: [{ url: photos[i % photos.length].url }],
        gallery: [
          { url: photos[(i + 1) % photos.length].url },
          { url: photos[(i + 2) % photos.length].url },
          { url: photos[(i + 3) % photos.length].url },
        ],
      },
    });
  });
  console.log(`  ${cat}: ${recs.length} items 매핑`);
}
console.log(`  PATCH ${itemUpdates.length}...`);
await patchBatch(T.items, itemUpdates);

// ─── 3) sections (intro/list) dump + PATCH ─────────
console.log('\n[3/3] sections dump + PATCH (img)...');
const sections = await dumpAll(T.section, ['slug', 'role']);
const targets = sections.filter(r => ['intro', 'list'].includes(r.fields.role));
const sectionsByCat = {};
for (const r of targets) {
  const cat = categoryOf(r.fields.slug || '');
  (sectionsByCat[cat] = sectionsByCat[cat] || []).push(r);
}
const sectionUpdates = [];
for (const [cat, recs] of Object.entries(sectionsByCat)) {
  const photos = (photoCache[cat]?.length >= 5) ? photoCache[cat] : photoCache.brand;
  if (!photos.length) continue;
  recs.forEach((r, i) => {
    // section 은 items 와 다른 idx 로 (3 step)
    sectionUpdates.push({
      id: r.id,
      fields: { img: [{ url: photos[(i * 3) % photos.length].url }] },
    });
  });
  console.log(`  ${cat}: ${recs.length} sections 매핑`);
}
console.log(`  PATCH ${sectionUpdates.length}...`);
await patchBatch(T.section, sectionUpdates);

console.log('\n✅ Complete!');
console.log(`  items: ${itemUpdates.length} (img + gallery)`);
console.log(`  sections: ${sectionUpdates.length} (img)`);
console.log(`  Unsplash 료칸 톤 이미지 — Picsum 덮어쓰기`);
