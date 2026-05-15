#!/usr/bin/env node
// mukayu-subname-restore.mjs
// items.notes 의 ## H2 prefix → 별도 items.subName 필드로 역분리
// 미니멀화 마이그레이션 (subName→notes 합침) 의 역방향

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const ITEMS_TBL = 'tblIrbig24H0axx5h';
const F = {
  name: 'fldQsGF8KULDI2Xdr',
  notes: 'fldvvQ6MI7PLwvE7C',
  subName: 'fldfXiQ20lsLzyb86',  // 방금 추가
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dumpAll() {
  const records = []; let offset = '';
  while (true) {
    const url = `https://api.airtable.com/v0/${BASE}/${ITEMS_TBL}?pageSize=100&fields%5B%5D=slug&fields%5B%5D=name&fields%5B%5D=notes` + (offset ? `&offset=${offset}` : '');
    const j = await fetch(url, { headers: H }).then(r => r.json());
    records.push(...j.records);
    if (!j.offset) break;
    offset = j.offset;
  }
  return records;
}

async function patch(ups) {
  for (let i = 0; i < ups.length; i += 10) {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${ITEMS_TBL}`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ records: ups.slice(i, i + 10), typecast: true }),
    });
    if (!r.ok) throw new Error(`PATCH: ${r.status} ${await r.text()}`);
    await sleep(220);
  }
}

console.log('[1] items dump...');
const items = await dumpAll();
console.log(`  total: ${items.length}`);

// notes 시작이 ## H2 인 record 추출
const updates = [];
for (const r of items) {
  const notes = r.fields.notes;
  if (typeof notes !== 'string' || !notes.startsWith('## ')) continue;

  // 첫 줄 H2 추출
  const firstNl = notes.indexOf('\n');
  const headLine = firstNl === -1 ? notes : notes.slice(0, firstNl);
  const subName = headLine.replace(/^##\s+/, '').trim();
  if (!subName) continue;

  // notes 에서 첫 줄 + 그 다음 빈 줄(들) 제거
  let rest = firstNl === -1 ? '' : notes.slice(firstNl + 1);
  rest = rest.replace(/^\n+/, '');  // 선두 빈 줄 제거

  updates.push({
    id: r.id,
    fields: {
      [F.subName]: subName.slice(0, 200),
      [F.notes]:   rest,
    },
  });
}
console.log(`[2] ## H2 prefix 분리 대상: ${updates.length}`);

if (updates.length === 0) {
  console.log('  (분리할 record 없음 — notes 안 ## prefix 없음)');
  process.exit(0);
}

console.log('  샘플 (첫 3개):');
updates.slice(0, 3).forEach(u => {
  const orig = items.find(r => r.id === u.id);
  console.log(`    [${orig.fields.slug}]`);
  console.log(`      subName ← "${u.fields[F.subName]}"`);
  console.log(`      notes(rest) ← "${(u.fields[F.notes] || '').slice(0, 60)}..."`);
});

console.log(`\n[3] PATCH ${updates.length} records...`);
await patch(updates);
console.log('  ✅');

console.log('\n완료:');
console.log(`  +items.subName field`);
console.log(`  ${updates.length} records 의 notes 첫 H2 → subName 분리`);
