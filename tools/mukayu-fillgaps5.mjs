#!/usr/bin/env node
// mukayu-fillgaps5.mjs — 명확한 누락만 추가
// 1) stay 의 Charter plan +1 item (tag=offer-단체-전세)
// 2) 스파-info +1 item (예약 안내)
// 3) stay 3 패키지의 subitems +6 (Program / Reservation / Additional)

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const T = { section: 'tblKy64yavSnr5WPG', tags: 'tblH0N7YFH9xZ72Zk',
            items: 'tblIrbig24H0axx5h', subitems: 'tblH7xgPQDp6Df5dV' };
const F = {
  items:    { name: 'fldQsGF8KULDI2Xdr', subName: 'fldd9P8bSoOCb6Ne6',
              section: 'fldOHZZe3m76HbSfh', tags: 'fldpurAPI52CI1ZFK',
              ctaUrl: 'fldViPuqLJkZqrxyM' },
  subitems: { name: 'fldtj8Z90Fr8XlEWE', items: 'fldnbrtaAnZ0btTW6' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(tbl, recs) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}`, {
    method: 'POST', headers: H, body: JSON.stringify({ records: recs.map(f => ({ fields: f })), typecast: true }),
  });
  if (!r.ok) throw new Error(`POST ${tbl}: ${r.status} ${await r.text()}`);
  return (await r.json()).records;
}
async function listBy(tbl, slugs) {
  const f = `OR(${slugs.map(s => `{slug}='${s.replace(/'/g, "\\'")}'`).join(',')})`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${tbl}?filterByFormula=${encodeURIComponent(f)}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${tbl}: ${r.status}`);
  const map = {};
  (await r.json()).records.forEach(rec => { map[rec.fields.slug] = rec.id; });
  return map;
}

console.log('[1/3] 기존 ID 확보...');
const sections = await listBy(T.section, ['오퍼-list', '스파-info']);
const tags = await listBy(T.tags, ['offer-단체-전세']);
const items = await listBy(T.items, [
  '오퍼-list-야쿠시야마-웰니스-리트릿',
  '오퍼-list-오모테나시-여정',
  '오퍼-list-2박-혜택-숙박',
]);
console.log('  sections:', Object.keys(sections));
console.log('  tags:', Object.keys(tags));
console.log('  items:', Object.keys(items));
await sleep(220);

// ─── 2. 신규 items 2 ──────────────────────────
console.log('[2/3] 신규 items 2 (Charter + 스파 예약)...');
const newItems = await post(T.items, [
  { [F.items.name]: '단체 전세 플랜',
    [F.items.subName]: '맞춤형 단체 머묾',
    [F.items.section]: [sections['오퍼-list']],
    [F.items.tags]:    [tags['offer-단체-전세']],
    [F.items.ctaUrl]:  'https://mukayu.com/charter-plan-for-a-tailored-group-escape/' },
  { [F.items.name]: '예약 안내',
    [F.items.section]: [sections['스파-info']],
    [F.items.ctaUrl]:  'https://mukayu.com/english/spa/' },
]);
console.log(`  +items: ${newItems.length}`);
await sleep(220);

// ─── 3. stay subitems +6 ──────────────────────
console.log('[3/3] stay 3 패키지 subitems +6...');
const SUBITEMS = [
  // 야쿠시야마 웰니스 (Program Overview + Reservation)
  { name: '프로그램 일정', items: ['오퍼-list-야쿠시야마-웰니스-리트릿'] },
  { name: '예약 안내',     items: ['오퍼-list-야쿠시야마-웰니스-리트릿'] },
  // 오모테나시 여정 (Example program + Reservation + Additional)
  { name: '프로그램 예시', items: ['오퍼-list-오모테나시-여정'] },
  { name: '예약 안내',     items: ['오퍼-list-오모테나시-여정'] },
  { name: '추가 안내',     items: ['오퍼-list-오모테나시-여정'] },
  // 2박 혜택 (Reservation)
  { name: '예약 안내',     items: ['오퍼-list-2박-혜택-숙박'] },
];
const subitemsRes = await post(T.subitems, SUBITEMS.map(s => ({
  [F.subitems.name]:  s.name,
  [F.subitems.items]: s.items.map(slug => items[slug]).filter(Boolean),
})));
console.log(`  +subitems: ${subitemsRes.length}`);

console.log('\n✅ Complete:');
console.log(`  +items=${newItems.length}  +subitems=${subitemsRes.length}`);
