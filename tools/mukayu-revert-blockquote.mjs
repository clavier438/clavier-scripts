#!/usr/bin/env node
// mukayu-revert-blockquote.mjs
// 41 q records 의 notes 에서 라인 시작 `> ` / `>` prefix 제거 (revert)

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { items: 'tblIrbig24H0axx5h' };
const F = {
  variantKey: 'fldxxJr2WhJzTxODD',
  notes: 'fldvvQ6MI7PLwvE7C',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('[1] q records 조회...');
const url = `https://api.airtable.com/v0/${BASE}/${T.items}?filterByFormula=${encodeURIComponent("{variantKey}='q'")}&fields%5B%5D=slug&fields%5B%5D=notes&pageSize=100`;
const list = (await (await fetch(url, { headers: H })).json()).records;
console.log(`  ${list.length} records`);

function fromBlockquote(notes) {
    if (!notes) return notes;
    const lines = notes.split('\n');
    return lines.map(l => {
        if (l.startsWith('> ')) return l.slice(2);
        if (l === '>') return '';
        return l;
    }).join('\n');
}

const updates = list
    .map(r => {
        const orig = r.fields.notes;
        const next = fromBlockquote(orig);
        return { id: r.id, slug: r.fields.slug, fields: { [F.notes]: next }, changed: next !== orig };
    })
    .filter(u => u.changed);

console.log(`[2] revert 대상: ${updates.length}`);

console.log('[3] PATCH...');
for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10).map(({id, fields}) => ({id, fields}));
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${T.items}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ records: batch }),
    });
    if (!res.ok) throw new Error(`PATCH batch ${i}: ${res.status} ${await res.text()}`);
    console.log(`  ✅ batch ${Math.floor(i/10) + 1}: ${batch.length} records`);
    if (i + 10 < updates.length) await sleep(220);
}

console.log(`\n완료. ${updates.length} records revert.`);
