#!/usr/bin/env node
// mukayu-import.mjs — 9.0.0_mukayuPure CSV → Airtable appDyu0d6afRVeJiZ (9.0.1_mukayu)
// 5 테이블 (pages / section / tags / items / subitems). stories 사용 안 함.
import { readFileSync } from 'fs';

const BASE_ID = 'appDyu0d6afRVeJiZ';
const AT_TOKEN = process.env.AIRTABLE_PAT;
if (!AT_TOKEN) throw new Error('AIRTABLE_PAT not set');

const HEADERS = {
  Authorization: `Bearer ${AT_TOKEN}`,
  'Content-Type': 'application/json',
};

const DIR = "/Users/clavier/Library/CloudStorage/GoogleDrive-hyuk439@gmail.com/내 드라이브/works_gdrive/airtable/projects/9.0.0_mukayuPure";

const T = {
  pages:    'tblUNBy8USlFqaVWN',
  section:  'tblKy64yavSnr5WPG',
  tags:     'tblH0N7YFH9xZ72Zk',
  items:    'tblIrbig24H0axx5h',
  subitems: 'tblH7xgPQDp6Df5dV',
};

const F = {
  pages: {
    name:    'fldrYODj09oJpQvGa',
    kind:    'fld1BgtUGY0pc29zI',
    section: 'fldlgeHmzongnXdL5',
  },
  section: {
    role:       'fldILF1GvQJweWQPd',
    name:       'fldSzBrqSlW0ZAmXQ',
    subName:    'fldfgKUt0PZZsEcYv',
    notes:      'fldxCLS4Qy08N33R1',
    ctaText:    'fldsxatO6E5zNhc2H',
    ctaUrl:     'fldVeI5PK4LOKXWEv',
    tags:       'fldrBmm7QwdZZzop9',
    filterMode: 'fldz7uqROiBNZfFf9',
    layout:     'fldiaPS5GhwmM2DMV',
    page:       'fldHRGctN7IIV1wyF',
    items:      'fldvDnbOrdSciKQIF',
  },
  tags: {
    name:  'fldDDwXKmxMWeE1U4',
    group: 'fldgMbNzB2ragRyLP',
  },
  items: {
    section:  'fldOHZZe3m76HbSfh',
    name:     'fldQsGF8KULDI2Xdr',
    subName:  'fldd9P8bSoOCb6Ne6',
    layout:   'fldg3U6NyQlZvue2w',
    notes:    'fldvvQ6MI7PLwvE7C',
    notes2:   'fld24FADPYYkJgktl',
    price:    'fldteQpBnefH4g96o',
    caption:  'fldB4gT5wHfIjEIy6',
    ctaText:  'fldqqfHwYdUcwJNii',
    ctaUrl:   'fldViPuqLJkZqrxyM',
    tags:     'fldpurAPI52CI1ZFK',
    subitems: 'fldBaKyONlWooW3j0',
  },
  subitems: {
    name:  'fldtj8Z90Fr8XlEWE',
    items: 'fldnbrtaAnZ0btTW6',
    notes: 'fld2HSmyvUgYB8z2k',
    price: 'fldQJkBob8jSW42VJ',
  },
};

// ─── CSV Parser ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let current = [], field = '', inQuotes = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; }
      else if (c === '"') { inQuotes = false; i++; }
      else { field += c; i++; }
    } else {
      if      (c === '"')                  { inQuotes = true; i++; }
      else if (c === ',')                  { current.push(field); field = ''; i++; }
      else if (c === '\r' && text[i+1] === '\n') { current.push(field); rows.push(current); current = []; field = ''; i += 2; }
      else if (c === '\n')                 { current.push(field); rows.push(current); current = []; field = ''; i++; }
      else                                 { field += c; i++; }
    }
  }
  if (current.length > 0) { current.push(field); if (current.some(f => f)) rows.push(current); }
  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(f => f.trim()))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
      return obj;
    });
}

// ─── Airtable helpers ────────────────────────────────────────────────────────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function atCreate(tableId, records) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ records: records.map(f => ({ fields: f })), typecast: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`POST ${tableId}: ${res.status} ${err}`);
  }
  return (await res.json()).records.map(r => r.id);
}

async function atUpdate(tableId, updates) {
  if (!updates.length) return;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ records: updates, typecast: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PATCH ${tableId}: ${res.status} ${err}`);
  }
  return await res.json();
}

async function createAll(tableId, fieldsList, slugs) {
  const idMap = {};
  const BATCH = 10;
  for (let i = 0; i < fieldsList.length; i += BATCH) {
    const batch = fieldsList.slice(i, i + BATCH);
    const batchSlugs = slugs.slice(i, i + BATCH);
    const ids = await atCreate(tableId, batch);
    ids.forEach((id, j) => { idMap[batchSlugs[j]] = id; });
    process.stdout.write(`\r  ${i + batch.length}/${fieldsList.length}`);
    await sleep(220);
  }
  console.log();
  return idMap;
}

async function updateAll(tableId, updates) {
  const BATCH = 10;
  for (let i = 0; i < updates.length; i += BATCH) {
    await atUpdate(tableId, updates.slice(i, i + BATCH));
    await sleep(220);
  }
}

function split(val) {
  if (!val || !val.trim()) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function resolve(slugs, ...maps) {
  return slugs.map(s => {
    for (const m of maps) if (m[s]) return m[s];
    return null;
  }).filter(Boolean);
}

// ─── Load CSVs ───────────────────────────────────────────────────────────────
const tagsCSV     = parseCSV(readFileSync(`${DIR}/mukayu_v9_tags.csv`, 'utf8'));
const pagesCSV    = parseCSV(readFileSync(`${DIR}/mukayu_v9_pages.csv`, 'utf8'));
const sectionCSV  = parseCSV(readFileSync(`${DIR}/mukayu_v9_section.csv`, 'utf8'));
const subitemsCSV = parseCSV(readFileSync(`${DIR}/mukayu_v9_subitems.csv`, 'utf8'));
const itemsCSV    = parseCSV(readFileSync(`${DIR}/mukayu_v9_items.csv`, 'utf8'));

console.log('CSV rows:');
console.log(`  tags=${tagsCSV.length}  pages=${pagesCSV.length}  section=${sectionCSV.length}`);
console.log(`  subitems=${subitemsCSV.length}  items=${itemsCSV.length}`);

// ─── Phase 1: Create without links ──────────────────────────────────────────

console.log('\n[1/5] tags...');
const tagsMap = await createAll(
  T.tags,
  tagsCSV.map(r => ({
    ...(r.name  ? { [F.tags.name]:  r.name }  : {}),
    ...(r.group ? { [F.tags.group]: r.group } : {}),
  })),
  tagsCSV.map(r => r.slug)
);

console.log('[2/5] subitems...');
const subitemsMap = await createAll(
  T.subitems,
  subitemsCSV.map(r => ({
    ...(r.name  ? { [F.subitems.name]:  r.name }  : {}),
    ...(r.notes ? { [F.subitems.notes]: r.notes } : {}),
    ...(r.price ? { [F.subitems.price]: r.price } : {}),
  })),
  subitemsCSV.map(r => r.slug)
);

console.log('[3/5] pages...');
const pagesMap = await createAll(
  T.pages,
  pagesCSV.map(r => ({
    ...(r.name ? { [F.pages.name]: r.name } : {}),
    ...(r.kind ? { [F.pages.kind]: r.kind } : {}),
  })),
  pagesCSV.map(r => r.slug)
);

console.log('[4/5] section...');
const sectionMap = await createAll(
  T.section,
  sectionCSV.map(r => ({
    ...(r.role       ? { [F.section.role]:       r.role }       : {}),
    ...(r.name       ? { [F.section.name]:       r.name }       : {}),
    ...(r.subName    ? { [F.section.subName]:    r.subName }    : {}),
    ...(r.notes      ? { [F.section.notes]:      r.notes }      : {}),
    ...(r.ctaText    ? { [F.section.ctaText]:    r.ctaText }    : {}),
    ...(r.ctaUrl     ? { [F.section.ctaUrl]:     r.ctaUrl }     : {}),
    ...(r.filterMode ? { [F.section.filterMode]: r.filterMode } : {}),
    ...(r.layout     ? { [F.section.layout]:     r.layout }     : {}),
  })),
  sectionCSV.map(r => r.slug)
);

console.log('[5/5] items...');
const itemsMap = await createAll(
  T.items,
  itemsCSV.map(r => ({
    ...(r.name    ? { [F.items.name]:    r.name }    : {}),
    ...(r.subName ? { [F.items.subName]: r.subName } : {}),
    ...(r.layout  ? { [F.items.layout]:  r.layout }  : {}),
    ...(r.notes   ? { [F.items.notes]:   r.notes }   : {}),
    ...(r.notes2  ? { [F.items.notes2]:  r.notes2 }  : {}),
    ...(r.price   ? { [F.items.price]:   r.price }   : {}),
    ...(r.caption ? { [F.items.caption]: r.caption } : {}),
    ...(r.ctaText ? { [F.items.ctaText]: r.ctaText } : {}),
    ...(r.ctaUrl  ? { [F.items.ctaUrl]:  r.ctaUrl }  : {}),
  })),
  itemsCSV.map(r => r.slug)
);

// items name → recordId (subitems.items column uses item name, not slug)
const itemsByName = {};
itemsCSV.forEach(r => {
  const id = itemsMap[r.slug];
  if (id && r.name) itemsByName[r.name] = id;
});

console.log('\n✅ Phase 1 done.\n[Links] starting...');

// ─── Phase 2: Link updates ───────────────────────────────────────────────────

// pages: section
{
  const updates = pagesCSV.map(r => {
    const id = pagesMap[r.slug];
    if (!id) return null;
    const fields = {};
    const sIds = resolve(split(r.section), sectionMap);
    if (sIds.length) fields[F.pages.section] = sIds;
    return Object.keys(fields).length ? { id, fields } : null;
  }).filter(Boolean);
  console.log(`[Links] pages (${updates.length} records)`);
  await updateAll(T.pages, updates);
}

// section: page, tags
{
  const updates = sectionCSV.map(r => {
    const id = sectionMap[r.slug];
    if (!id) return null;
    const fields = {};
    const pIds  = resolve(split(r.page), pagesMap);
    const tIds  = resolve(split(r.tags), tagsMap);
    if (pIds.length) fields[F.section.page] = pIds;
    if (tIds.length) fields[F.section.tags] = tIds;
    return Object.keys(fields).length ? { id, fields } : null;
  }).filter(Boolean);
  console.log(`[Links] section (${updates.length} records)`);
  await updateAll(T.section, updates);
}

// items: section, tags, subitems
{
  const updates = itemsCSV.map(r => {
    const id = itemsMap[r.slug];
    if (!id) return null;
    const fields = {};
    const secIds = resolve(split(r.section),  sectionMap);
    const tagIds = resolve(split(r.tags),     tagsMap);
    const subIds = resolve(split(r.subitems), subitemsMap);
    if (secIds.length) fields[F.items.section]  = secIds;
    if (tagIds.length) fields[F.items.tags]     = tagIds;
    if (subIds.length) fields[F.items.subitems] = subIds;
    return Object.keys(fields).length ? { id, fields } : null;
  }).filter(Boolean);
  console.log(`[Links] items (${updates.length} records)`);
  await updateAll(T.items, updates);
}

// subitems: items (CSV uses item name, not slug)
{
  const updates = subitemsCSV.map(r => {
    const id = subitemsMap[r.slug];
    if (!id) return null;
    const fields = {};
    const iIds = split(r.items).map(name => itemsByName[name]).filter(Boolean);
    if (iIds.length) fields[F.subitems.items] = iIds;
    return Object.keys(fields).length ? { id, fields } : null;
  }).filter(Boolean);
  console.log(`[Links] subitems (${updates.length} records)`);
  await updateAll(T.subitems, updates);
}

console.log('\n✅ Import complete!');
console.log('Records created:');
console.log(`  tags=${Object.keys(tagsMap).length}  pages=${Object.keys(pagesMap).length}  section=${Object.keys(sectionMap).length}`);
console.log(`  subitems=${Object.keys(subitemsMap).length}  items=${Object.keys(itemsMap).length}`);
