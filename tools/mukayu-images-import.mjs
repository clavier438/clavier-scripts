#!/usr/bin/env node
// mukayu-images-import.mjs
// 소스 base (appdPTztnEtQeSHRQ) 의 items.img + gallery1~10
//   → 타겟 9.0.2_mukayu (appDyu0d6afRVeJiZ) 의 items.img + gallery (통합)
// 매칭 키 = name
// PATCH = URL only (Airtable 가 자동 미러)

const SRC = 'appdPTztnEtQeSHRQ';
const TGT = 'appDyu0d6afRVeJiZ';
const ITEMS = 'tblIrbig24H0axx5h';

const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAll(baseId, tableId, fieldNames) {
    const records = [];
    let offset = '';
    while (true) {
        const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
        url.searchParams.set('pageSize', '100');
        fieldNames.forEach(f => url.searchParams.append('fields[]', f));
        if (offset) url.searchParams.set('offset', offset);
        const r = await (await fetch(url, { headers: H })).json();
        records.push(...r.records);
        if (!r.offset) break;
        offset = r.offset;
    }
    return records;
}

console.log('[1] 소스 items fetch (name + img + gallery1~10)...');
const srcFields = ['name', 'img', ...Array.from({length:10}, (_,i)=>`gallery${i+1}`)];
const src = await fetchAll(SRC, ITEMS, srcFields);
console.log(`  ${src.length} records`);

console.log('[2] 타겟 items fetch (name)...');
const tgt = await fetchAll(TGT, ITEMS, ['name']);
console.log(`  ${tgt.length} records`);

console.log('[3] 매핑 + PATCH 준비...');
// 동명 record 다수 가능 → 첫 매칭만 (또는 다중 매칭 처리)
const tgtByName = {};
for (const r of tgt) {
    const n = r.fields.name;
    if (!n) continue;
    if (!tgtByName[n]) tgtByName[n] = [];
    tgtByName[n].push(r.id);
}

const updates = [];
let stat = { withImg: 0, withGallery: 0, noMatch: 0, noImage: 0, multiMatch: 0 };
const noMatchNames = [];

for (const s of src) {
    const name = s.fields.name;
    if (!name) continue;
    const tgtIds = tgtByName[name];
    if (!tgtIds || tgtIds.length === 0) {
        stat.noMatch++;
        noMatchNames.push(name);
        continue;
    }
    if (tgtIds.length > 1) stat.multiMatch++;

    const fields = {};
    const srcImg = s.fields.img;
    if (Array.isArray(srcImg) && srcImg.length > 0) {
        fields.img = srcImg.map(a => ({ url: a.url, filename: a.filename }));
        stat.withImg++;
    }

    const galleryUrls = [];
    for (let i = 1; i <= 10; i++) {
        const arr = s.fields[`gallery${i}`];
        if (Array.isArray(arr)) {
            for (const a of arr) galleryUrls.push({ url: a.url, filename: a.filename });
        }
    }
    if (galleryUrls.length > 0) {
        fields.gallery = galleryUrls;
        stat.withGallery++;
    }

    if (Object.keys(fields).length === 0) {
        stat.noImage++;
        continue;
    }

    // 동명 record 모두 update
    for (const tgtId of tgtIds) {
        updates.push({ id: tgtId, fields });
    }
}

console.log(`  매칭 record: ${src.length - stat.noMatch} / ${src.length}`);
console.log(`  withImg: ${stat.withImg}, withGallery: ${stat.withGallery}`);
console.log(`  no match: ${stat.noMatch}, no image: ${stat.noImage}, multi-match: ${stat.multiMatch}`);

if (noMatchNames.length > 0 && noMatchNames.length <= 20) {
    console.log(`  no-match samples (${noMatchNames.length}):`);
    noMatchNames.forEach(n => console.log(`    - ${n}`));
} else if (noMatchNames.length > 20) {
    console.log(`  no-match (${noMatchNames.length}, top 20):`);
    noMatchNames.slice(0, 20).forEach(n => console.log(`    - ${n}`));
}

console.log(`\n[4] PATCH ${updates.length} updates...`);
for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const res = await fetch(`https://api.airtable.com/v0/${TGT}/${ITEMS}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ records: batch }),
    });
    if (!res.ok) throw new Error(`PATCH batch ${i}: ${res.status} ${await res.text()}`);
    process.stdout.write('.');
    if (i + 10 < updates.length) await sleep(220);
}
console.log(`\n\n완료. ${updates.length} records 이미지 PATCH.`);
