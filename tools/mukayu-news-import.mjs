#!/usr/bin/env node
// mukayu-news-import.mjs — mukayu WP 99 게시물 → 9.0.1_mukayu 소식-list
// title + ctaUrl + tags(category 매핑) 만. 본문 paragraph 옮기지 않음.
// Scott Haas 책 시리즈 (cat=183) 는 skip — placeholder 가 시리즈 대표.
import { readFileSync } from 'fs';

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { section: 'tblKy64yavSnr5WPG', tags: 'tblH0N7YFH9xZ72Zk', items: 'tblIrbig24H0axx5h' };
const F = {
  section: { tags: 'fldrBmm7QwdZZzop9' },
  tags:    { name: 'fldDDwXKmxMWeE1U4', group: 'fldgMbNzB2ragRyLP' },
  items:   { name: 'fldQsGF8KULDI2Xdr', section: 'fldOHZZe3m76HbSfh',
             tags: 'fldpurAPI52CI1ZFK', ctaUrl: 'fldViPuqLJkZqrxyM' },
};

// mukayu WP category ID → 우리 tag slug
const CAT_MAP = {
  76:  'news-뉴스',
  78:  'news-행사',
  147: 'news-보도자료',
  79:  'news-relais-&-chateaux',
  156: 'news-단독-혜택',
  77:  'news-지속가능성',
  183: 'news-scott-haas',
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
  if (!slugs.length) return {};
  const f = `OR(${slugs.map(s => `{slug}='${s.replace(/'/g, "\\'")}'`).join(',')})`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}?filterByFormula=${encodeURIComponent(f)}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${tbl}: ${r.status}`);
  const map = {};
  (await r.json()).records.forEach(rec => { map[rec.fields.slug] = rec.id; });
  return map;
}
function decode(s) {
  return s.replace(/&#038;/g, '&').replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'").replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '-').replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

// ─── 1. 신규 tags 2 ──────────────────────────
console.log('[1/5] 신규 tags (지속가능성, scott haas)...');
const existing = await listBy(T.tags, ['news-지속가능성', 'news-scott-haas']);
const toAdd = [];
if (!existing['news-지속가능성']) toAdd.push({ [F.tags.name]: '지속가능성', [F.tags.group]: 'news' });
if (!existing['news-scott-haas']) toAdd.push({ [F.tags.name]: 'scott haas',  [F.tags.group]: 'news' });
if (toAdd.length) {
  const res = await post(T.tags, toAdd);
  res.forEach(r => { existing[r.fields.slug] = r.id; });
}
console.log(`  +${toAdd.length} tags`);
await sleep(220);

// ─── 2. 모든 7 news tag IDs 확보 ─────────────
const allNewsTags = await listBy(T.tags, [
  'news-뉴스', 'news-행사', 'news-보도자료', 'news-relais-&-chateaux',
  'news-단독-혜택', 'news-지속가능성', 'news-scott-haas',
]);
console.log(`  news tags total: ${Object.keys(allNewsTags).length}`);

// ─── 3. 소식-list section ID ──────────────────
const sections = await listBy(T.section, ['소식-list']);
const newsSectionId = sections['소식-list'];

// ─── 4. posts JSON 로드 + filter ──────────────
const posts = JSON.parse(readFileSync('/tmp/mukayu_news.json', 'utf8'));
console.log(`[2/5] mukayu posts loaded: ${posts.length}`);
// Scott Haas 책 챕터 (cat=183 포함) skip — placeholder 가 시리즈 대표
const filtered = posts.filter(p => !p.categories.includes(183));
console.log(`  filtered (excl. Scott Haas chapters): ${filtered.length}`);

// ─── 5. atCreate items (batch 10) ─────────────
console.log('[3/5] atCreate items...');
const itemsToCreate = filtered.map(p => {
  const title = decode(p.title.rendered);
  const tagIds = p.categories.map(c => allNewsTags[CAT_MAP[c]]).filter(Boolean);
  return {
    [F.items.name]:    title,
    [F.items.section]: [newsSectionId],
    [F.items.ctaUrl]:  p.link,
    ...(tagIds.length ? { [F.items.tags]: tagIds } : {}),
  };
});
let total = 0;
for (let i = 0; i < itemsToCreate.length; i += 10) {
  const batch = itemsToCreate.slice(i, i + 10);
  const res = await post(T.items, batch);
  total += res.length;
  process.stdout.write(`\r  ${total}/${itemsToCreate.length}`);
  if (i + 10 < itemsToCreate.length) await sleep(220);
}
console.log();

// ─── 6. 소식-list section.tags = 7 ────────────
console.log('[4/5] 소식-list section.tags = 7 news tags...');
await patch(T.section, [{
  id: newsSectionId,
  fields: { [F.section.tags]: Object.values(allNewsTags) },
}]);
await sleep(220);

// ─── 7. placeholder PATCH = scott-haas tag link ─
console.log('[5/5] placeholder Scott Haas item PATCH...');
const placeholder = await listBy(T.items, ['소식-list-scott-haas-goes-to-meet-sachiko-nakamichi']);
const phId = placeholder['소식-list-scott-haas-goes-to-meet-sachiko-nakamichi'];
if (phId) {
  await patch(T.items, [{
    id: phId,
    fields: {
      [F.items.tags]:    [allNewsTags['news-scott-haas'], allNewsTags['news-보도자료']],
      [F.items.ctaUrl]:  'https://mukayu.com/scott-haas-goes-to-meet-sachiko-nakamichi-the-japanese-way-of-acceptance/',
    },
  }]);
  console.log('  placeholder updated');
} else {
  console.log('  placeholder not found (skip)');
}

console.log('\n✅ Complete');
console.log(`  +tags=${toAdd.length}  +items=${total}  patches=2`);
