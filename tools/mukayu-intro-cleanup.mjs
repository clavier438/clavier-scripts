#!/usr/bin/env node
// mukayu-intro-cleanup.mjs
// intro section 안 items 중 variantKey != q 인 것들을 같은 page 의 story section 으로 이전

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = {
  section: 'tblKy64yavSnr5WPG',
  items: 'tblIrbig24H0axx5h',
};
const F = {
  section: { role: 'fldILF1GvQJweWQPd', page: 'fldHRGctN7IIV1wyF' },
  items:   { section: 'fldOHZZe3m76HbSfh', variantKey: 'fldxxJr2WhJzTxODD' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('[0] pages fetch (kind != meta filter 용)...');
const pagesUrl = `https://api.airtable.com/v0/${BASE}/tblUNBy8USlFqaVWN?fields%5B%5D=slug&fields%5B%5D=kind&pageSize=100`;
const pages = (await (await fetch(pagesUrl, { headers: H })).json()).records;
const pageKindMap = Object.fromEntries(pages.map(p => [p.id, p.fields.kind]));
const contentPageIds = pages.filter(p => p.fields.kind !== 'meta').map(p => p.id);
console.log(`  ${pages.length} pages, content (kind != meta): ${contentPageIds.length}`);

console.log('\n[1] sections (intro + story) list...');
const sectionsUrl = `https://api.airtable.com/v0/${BASE}/${T.section}?filterByFormula=${encodeURIComponent("OR({role}='intro',{role}='story')")}&fields%5B%5D=slug&fields%5B%5D=role&fields%5B%5D=page&pageSize=100`;
const sections = (await (await fetch(sectionsUrl, { headers: H })).json()).records;

const pageMap = {};
for (const s of sections) {
    const pageId = (s.fields.page || [])[0];
    if (!pageId) continue;
    if (!pageMap[pageId]) pageMap[pageId] = {};
    pageMap[pageId][s.fields.role] = s.id;
}
console.log(`  ${sections.length} sections, ${Object.keys(pageMap).length} pages`);

const introSectionIds = sections
    .filter(s => s.fields.role === 'intro')
    .filter(s => contentPageIds.includes((s.fields.page || [])[0]))  // brand (meta) 제외
    .map(s => s.id);
console.log(`  intro sections (content only, meta 제외): ${introSectionIds.length}`);

console.log('\n[2] items 전체 fetch...');
let items = [];
let offset = '';
while (true) {
    const url = `https://api.airtable.com/v0/${BASE}/${T.items}?fields%5B%5D=slug&fields%5B%5D=section&fields%5B%5D=variantKey&pageSize=100${offset ? '&offset=' + offset : ''}`;
    const r = await (await fetch(url, { headers: H })).json();
    items.push(...r.records);
    if (!r.offset) break;
    offset = r.offset;
}
console.log(`  ${items.length} total items`);

const introItems = items.filter(i => {
    const sec = (i.fields.section || [])[0];
    return introSectionIds.includes(sec);
});
console.log(`  intro section 안 items: ${introItems.length}`);
console.log(`    variantKey=q: ${introItems.filter(i => i.fields.variantKey === 'q').length}`);
console.log(`    variantKey!=q: ${introItems.filter(i => i.fields.variantKey !== 'q').length}`);

const toMove = introItems
    .filter(i => i.fields.variantKey !== 'q')
    .map(i => {
        const introSecId = (i.fields.section || [])[0];
        const introSec = sections.find(s => s.id === introSecId);
        const pageId = (introSec.fields.page || [])[0];
        const storySecId = pageMap[pageId]?.story;
        return { id: i.id, slug: i.fields.slug, variantKey: i.fields.variantKey, storySecId, pageId };
    })
    .filter(m => m.storySecId);

console.log(`\n[3] story 로 이전 대상: ${toMove.length}`);
toMove.forEach(m => console.log(`  [${m.slug}]  variantKey=${m.variantKey}  →  story (${m.storySecId})`));

const noStoryTarget = introItems
    .filter(i => i.fields.variantKey !== 'q')
    .filter(i => {
        const introSecId = (i.fields.section || [])[0];
        const introSec = sections.find(s => s.id === introSecId);
        const pageId = (introSec.fields.page || [])[0];
        return !pageMap[pageId]?.story;
    });

if (noStoryTarget.length > 0) {
    console.log(`\n⚠️ story section 없는 page 의 items (이전 안 됨): ${noStoryTarget.length}`);
    noStoryTarget.forEach(i => console.log(`  [${i.fields.slug}]`));
}

if (toMove.length === 0) {
    console.log('\n이전할 records 없음.');
    process.exit(0);
}

console.log('\n[4] PATCH (section link 변경)...');
const updates = toMove.map(m => ({ id: m.id, fields: { [F.items.section]: [m.storySecId] }}));
for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${T.items}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ records: batch }),
    });
    if (!res.ok) throw new Error(`PATCH batch ${i}: ${res.status} ${await res.text()}`);
    console.log(`  ✅ batch ${Math.floor(i/10) + 1}: ${batch.length} records`);
    if (i + 10 < updates.length) await sleep(220);
}

console.log(`\n완료. ${updates.length} items → story section.`);
