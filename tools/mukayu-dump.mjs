#!/usr/bin/env node
// mukayu-dump.mjs — 9.0.1_mukayu 전체 records dump (구조 분석용)

import "./lib/freshness.mjs"

import { writeFileSync } from 'fs';

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
  pages:    'tblUNBy8USlFqaVWN',
  section:  'tblKy64yavSnr5WPG',
  items:    'tblIrbig24H0axx5h',
  subitems: 'tblH7xgPQDp6Df5dV',
  tags:     'tblH0N7YFH9xZ72Zk',
};

async function dumpAll(tbl, fields) {
  const records = []; let offset = '';
  while (true) {
    const fp = fields.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    const url = `https://api.airtable.com/v0/${BASE}/${tbl}?pageSize=100${fp}` + (offset ? `&offset=${offset}` : '');
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error(`GET ${tbl}: ${r.status}`);
    const j = await r.json();
    records.push(...j.records.map(rec => ({ id: rec.id, ...rec.fields })));
    if (!j.offset) break;
    offset = j.offset;
  }
  return records;
}

const out = {
  pages:    await dumpAll(T.pages,    ['slug', 'name', 'kind', 'section']),
  section:  await dumpAll(T.section,  ['slug', 'role', 'name', 'page', 'items', 'tags', 'filterModeManual', 'layout1', 'ctaText']),
  items:    await dumpAll(T.items,    ['slug', 'name', 'section', 'subitems', 'layout1', 'layoutManual', 'tags', 'caption', 'price', 'ctaUrl', 'notes', 'img', 'gallery']),
  subitems: await dumpAll(T.subitems, ['slug', 'name', 'items', 'tags', 'price', 'notes']),
  tags:     await dumpAll(T.tags,     ['slug', 'name', 'group', 'items', 'section']),
};

console.log('Records:');
console.log(`  pages:    ${out.pages.length}`);
console.log(`  section:  ${out.section.length}`);
console.log(`  items:    ${out.items.length}`);
console.log(`  subitems: ${out.subitems.length}`);
console.log(`  tags:     ${out.tags.length}`);

// items / sections 의 fields presence (어떤 필드가 채워있는지 비율)
const presence = (records, fields) => Object.fromEntries(fields.map(f => [f,
  records.filter(r => {
    const v = r[f];
    return v !== undefined && v !== null && v !== '' &&
      !(Array.isArray(v) && v.length === 0);
  }).length
]));
console.log('\nitems fields presence:');
console.log(presence(out.items, ['name','notes','img','gallery','price','caption','ctaUrl','tags','subitems','layoutManual','layout1']));
console.log('\nlayout1 분포 (items):');
const layoutCounts = {};
out.items.forEach(r => { layoutCounts[r.layout1 || '(empty)'] = (layoutCounts[r.layout1 || '(empty)'] || 0) + 1; });
console.log(layoutCounts);

writeFileSync('/tmp/mukayu_dump.json', JSON.stringify(out, null, 2));
console.log('\n→ /tmp/mukayu_dump.json (' + (JSON.stringify(out).length / 1024).toFixed(1) + 'KB)');
