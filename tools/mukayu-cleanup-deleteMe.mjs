#!/usr/bin/env node
// mukayu-cleanup-deleteMe.mjs
// deleteMe!_ prefix records 일괄 삭제 (PAT REST)
// - mukayu base (appDyu0d6afRVeJiZ) items: 7개
// - 디자인 베이스 (app9b7X9Tn2SXGuMW) strategy_notes: 12개

import "./lib/freshness.mjs"

const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}` };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listDeleteMe(baseId, tableId, primaryFieldName) {
    const records = [];
    let offset = '';
    while (true) {
        const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
        url.searchParams.set('filterByFormula', `FIND('deleteMe', {${primaryFieldName}})`);
        url.searchParams.append('fields[]', primaryFieldName);
        url.searchParams.set('pageSize', '100');
        if (offset) url.searchParams.set('offset', offset);
        const r = await (await fetch(url, { headers: H })).json();
        records.push(...r.records);
        if (!r.offset) break;
        offset = r.offset;
    }
    return records.map(r => ({ id: r.id, name: r.fields[primaryFieldName] }));
}

async function deleteBatch(baseId, tableId, records) {
    let total = 0;
    for (let i = 0; i < records.length; i += 10) {
        const batch = records.slice(i, i + 10);
        const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
        batch.forEach(r => url.searchParams.append('records[]', r.id));
        const res = await fetch(url, { method: 'DELETE', headers: H });
        if (!res.ok) throw new Error(`DELETE batch ${i}: ${res.status} ${await res.text()}`);
        total += batch.length;
        process.stdout.write('.');
        if (i + 10 < records.length) await sleep(220);
    }
    return total;
}

console.log('[D-1] mukayu items deleteMe!_ list...');
const mukayuItems = await listDeleteMe('appDyu0d6afRVeJiZ', 'tblIrbig24H0axx5h', 'name');
console.log(`  ${mukayuItems.length} records`);
mukayuItems.forEach(r => console.log(`    - ${r.name}`));

console.log('\n[D-2] 디자인 베이스 strategy_notes deleteMe!_ list...');
const designNotes = await listDeleteMe('app9b7X9Tn2SXGuMW', 'tblmefDfM6MBdtbtV', 'Name');
console.log(`  ${designNotes.length} records`);
designNotes.forEach(r => console.log(`    - ${r.name}`));

console.log(`\n총 ${mukayuItems.length + designNotes.length} records DELETE 진행...`);

if (mukayuItems.length > 0) {
    process.stdout.write('  mukayu items: ');
    const n = await deleteBatch('appDyu0d6afRVeJiZ', 'tblIrbig24H0axx5h', mukayuItems);
    console.log(` ${n} deleted`);
}

if (designNotes.length > 0) {
    process.stdout.write('  design strategy_notes: ');
    const n = await deleteBatch('app9b7X9Tn2SXGuMW', 'tblmefDfM6MBdtbtV', designNotes);
    console.log(` ${n} deleted`);
}

console.log('\n완료. 19개 records 정리됨.');
