#!/usr/bin/env node
// mukayu-q-to-blockquote.mjs
// items.variantKey === 'q' 인 records 의 notes 를 마크다운 blockquote 로 변환
// (각 라인 앞 `> ` 박기, 빈 라인은 `>`)
// Framer 측에서 blockquote text style 을 bodyImpact 와 동일하게 설정 → 큰 강조 본문 효과

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

function toBlockquote(notes) {
    if (!notes) return notes;
    const lines = notes.split('\n');
    if (lines.every(l => !l.trim() || l.startsWith('>'))) return notes; // 이미 blockquote
    return lines.map(l => l.trim() ? `> ${l}` : '>').join('\n');
}

const updates = list
    .map(r => {
        const orig = r.fields.notes;
        const next = toBlockquote(orig);
        return { id: r.id, slug: r.fields.slug, fields: { [F.notes]: next }, changed: next !== orig };
    })
    .filter(u => u.changed);

console.log(`[2] 변환 대상 (이미 blockquote 인 것 제외): ${updates.length}`);

console.log('[3] 샘플 (앞 3개):');
updates.slice(0, 3).forEach(u => {
    console.log(`  [${u.slug}]`);
    console.log(`    ${u.fields[F.notes].split('\n').slice(0, 3).join('\n    ')}`);
});

console.log('\n[4] PATCH 진행...');
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

console.log(`\n완료. ${updates.length} records → 마크다운 blockquote.`);
