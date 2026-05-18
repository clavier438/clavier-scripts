#!/usr/bin/env node
// mukayu-story-sections.mjs
// section.role 에 'story' 옵션 추가 + 11 페이지 마다 {page}-story section 신설

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { pages: 'tblUNBy8USlFqaVWN', section: 'tblKy64yavSnr5WPG' };
const F = {
  section: { role: 'fldILF1GvQJweWQPd', name: 'fldSzBrqSlW0ZAmXQ',
             layout: 'fldiaPS5GhwmM2DMV', page: 'fldHRGctN7IIV1wyF',
             filterModeManual: 'fldz7uqROiBNZfFf9' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listAllPages() {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${T.pages}?fields%5B%5D=slug&pageSize=100`, { headers: H });
  return (await r.json()).records;
}

async function post(recs) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${T.section}`, {
    method: 'POST', headers: H, body: JSON.stringify({ records: recs.map(f => ({ fields: f })), typecast: true }),
  });
  if (!r.ok) throw new Error(`POST: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}

async function batchPost(recs) {
  const out = [];
  for (let i = 0; i < recs.length; i += 10) {
    out.push(...await post(recs.slice(i, i + 10)));
    if (i + 10 < recs.length) await sleep(220);
  }
  return out;
}

console.log('[1] pages list...');
const pages = await listAllPages();
console.log(`  ${pages.length} pages`);

console.log('\n[2] {page}-story section 신설 (typecast 로 role=story 옵션 자동 추가)...');
const newSections = pages.map(p => ({
  [F.section.role]:   'story',
  [F.section.filterModeManual]: 'none',
  [F.section.page]:   [p.id],
}));

const created = await batchPost(newSections);
console.log(`  +${created.length} sections`);
created.forEach(r => console.log(`    ✅ ${r.fields.slug}  (role=${r.fields.role})`));

console.log('\n완료. 각 story section 안 narrative items 는 비어있음. 사용자 자유로 채움.');
