#!/usr/bin/env node
// mukayu-fix-links.mjs — atCreate 후 누락된 items.tags link 4개 수정
// (slug formula 가 띄어쓰기 → 하이픈으로 split 해서 lookup 키 mismatch 였음)

import "./lib/freshness.mjs"

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
  tags:  'tblH0N7YFH9xZ72Zk',
  items: 'tblIrbig24H0axx5h',
};
const F_ITEMS_TAGS = 'fldpurAPI52CI1ZFK';

async function listBy(tbl, slugs) {
  const f = `OR(${slugs.map(s => `{slug}='${s}'`).join(',')})`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}?filterByFormula=${encodeURIComponent(f)}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${tbl}: ${r.status} ${await r.text()}`);
  const map = {};
  (await r.json()).records.forEach(rec => { map[rec.fields.slug] = rec.id; });
  return map;
}

async function patch(tbl, ups) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ records: ups, typecast: true }),
  });
  if (!r.ok) throw new Error(`PATCH ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}

const PAIRS = [
  { item: '오퍼-list-1인-특별-플랜',     tag: 'offer-시즌-추천' },
  { item: '오퍼-list-2박-혜택-숙박',     tag: 'offer-장기-숙박' },
  { item: '오퍼-list-특별한-행사',       tag: 'offer-특별한-날' },
  { item: '오퍼-list-오모테나시-여정',   tag: 'offer-단체-전세' },
];

console.log('[1] tag IDs lookup...');
const tagsMap = await listBy(T.tags, [...new Set(PAIRS.map(p => p.tag))]);
console.log('  ', tagsMap);

console.log('[2] item IDs lookup...');
const itemsMap = await listBy(T.items, PAIRS.map(p => p.item));
console.log('  ', Object.keys(itemsMap).length, 'items found');

console.log('[3] PATCH items.tags...');
const ups = PAIRS.map(p => ({
  id: itemsMap[p.item],
  fields: { [F_ITEMS_TAGS]: [tagsMap[p.tag]] },
})).filter(u => u.id && u.fields[F_ITEMS_TAGS][0]);

if (ups.length !== 4) {
  console.error('Missing IDs:', { tagsMap, itemsMap });
  process.exit(1);
}

const res = await patch(T.items, ups);
console.log(`  ✅ ${res.length} items patched`);
