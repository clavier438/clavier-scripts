#!/usr/bin/env node
// mukayu-symbol-catalog.mjs — 9.0.1 의 모든 텍스트 필드에서 특수문자 추출 + 빈도 + 컨텍스트 샘플

import "./lib/freshness.mjs"
import { join } from "path";
import { findClavierHq } from "./lib/repoPaths.mjs";

const BASE = 'appDyu0d6afRVeJiZ';
const TOKEN = process.env.AIRTABLE_PAT;
if (!TOKEN) throw new Error('AIRTABLE_PAT not set');
const H = { Authorization: `Bearer ${TOKEN}` };

const TABLES = {
  items:    { tbl: 'tblIrbig24H0axx5h', fields: ['name', 'subName', 'notes', 'price', 'caption'] },
  section:  { tbl: 'tblKy64yavSnr5WPG', fields: ['name', 'notes', 'ctaText'] },
  subitems: { tbl: 'tblH7xgPQDp6Df5dV', fields: ['name', 'notes', 'price'] },
};

async function dumpAll(tbl, fields) {
  const records = []; let offset = '';
  while (true) {
    const fp = fields.map(f => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
    const url = `https://api.airtable.com/v0/${BASE}/${tbl}?pageSize=100${fp}` + (offset ? `&offset=${offset}` : '');
    const j = await fetch(url, { headers: H }).then(r => r.json());
    records.push(...j.records);
    if (!j.offset) break;
    offset = j.offset;
  }
  return records;
}

function isSpecial(ch) {
  const code = ch.codePointAt(0);
  // ASCII printable (영문/숫자/기본 punctuation)
  if (code >= 0x20 && code <= 0x7E) return false;
  // 줄바꿈/탭
  if (ch === '\n' || ch === '\t' || ch === '\r') return false;
  // 한글 (가-힣)
  if (code >= 0xAC00 && code <= 0xD7A3) return false;
  // 한글 자모
  if (code >= 0x3131 && code <= 0x318E) return false;
  // 한자 — CJK Unified Ideographs (제외하면 일본어 한자도 제외)
  if (code >= 0x4E00 && code <= 0x9FFF) return false;
  // 히라가나·카타카나
  if (code >= 0x3040 && code <= 0x30FF) return false;
  return true;
}

const counter = new Map();   // ch → { count, samples: Set<string> }

function record(ch, context) {
  let entry = counter.get(ch);
  if (!entry) {
    entry = { count: 0, samples: new Set() };
    counter.set(ch, entry);
  }
  entry.count++;
  if (entry.samples.size < 3) entry.samples.add(context);
}

function scan(text) {
  if (typeof text !== 'string') return;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isSpecial(ch)) {
      // ±20 글자 컨텍스트
      const ctx = text.slice(Math.max(0, i - 15), Math.min(text.length, i + 15)).replace(/\n/g, ' ');
      record(ch, ctx);
    }
  }
}

console.log('[1] 모든 records dump...');
for (const [name, { tbl, fields }] of Object.entries(TABLES)) {
  const recs = await dumpAll(tbl, fields);
  console.log(`  ${name}: ${recs.length}`);
  for (const r of recs) {
    for (const f of fields) {
      scan(r.fields?.[f]);
    }
  }
}

console.log(`\n[2] 추출된 특수문자: ${counter.size}개\n`);

// 빈도순 정렬
const sorted = [...counter.entries()].sort((a, b) => b[1].count - a[1].count);

const COMMON_NAMES = {
  '◎': '강조 점 (사전 예약·필수 항목 표시)',
  '○': '빈 원',
  '●': '꽉 찬 점',
  '・': '일본식 dot',
  '·': '중간점',
  '※': '주석·각주',
  '→': '오른쪽 화살',
  '←': '왼쪽 화살',
  '▶': '재생·단방향 화살',
  '◀': '역방향',
  '★': '별',
  '☆': '빈 별',
  '—': 'em-dash (긴 줄표)',
  '–': 'en-dash (짧은 줄표)',
  '“': '여는 큰따옴표',
  '”': '닫는 큰따옴표',
  '‘': '여는 작은따옴표',
  '’': '닫는 작은따옴표',
  '「': '일본 여는 따옴표',
  '」': '일본 닫는 따옴표',
  '『': '일본 책제목 따옴표',
  '』': '일본 책제목 닫음',
  '【': '강조 브래킷',
  '】': '강조 브래킷 닫음',
  '〈': '꺾쇠 여는',
  '〉': '꺾쇠 닫는',
  '〜': '물결 (~의 일본 변형)',
  '￥': '엔화 (전각)',
  '¥': '엔화',
  '◇': '빈 마름모',
  '◆': '꽉 찬 마름모',
  '✓': '체크',
  '✕': '엑스',
  '＊': '전각 별표',
  '*': 'asterisk',
  '•': 'bullet',
  '…': '말줄임표',
  '※': '주석',
};

const lines = sorted.map(([ch, { count, samples }]) => {
  const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  const name = COMMON_NAMES[ch] || '';
  const sampleStr = [...samples].slice(0, 2).map(s => `\`${s}\``).join(' / ');
  return `| \`${ch}\` | U+${code} | ${count} | ${name} | ${sampleStr} |`;
});

const hq = findClavierHq();
if (!hq) throw new Error("clavier-hq 못 찾음 — sibling 클론 또는 CLAVIER_HQ env 설정 필요.");
const outDir = join(hq, 'projects/mukayu');
const outFile = `${outDir}/SYMBOL_CATALOG.md`;
const md = `# 9.0.1_mukayu 특수문자 카탈로그

> 모든 텍스트 필드 (items.notes/price/caption/name/subName, section.notes/name/ctaText, subitems.notes/price/name) 자동 추출.
> 빈도 순 정렬. mukayu 본문에서 *컨벤셔널하게 list 마커·강조·기호 대체* 로 사용 중인 문자.

## 추출된 특수문자 (${counter.size}개)

| 문자 | code | 빈도 | 의미·용도 | 샘플 컨텍스트 |
|---|---|---:|---|---|
${lines.join('\n')}

---

## Framer 마커 라이브러리 만드는 법 (사용자 작업)

위 카탈로그에서 *자주 쓰이는 마커* (◎ / — / ※ 등) 를 골라 Framer 컴포넌트로:

1. Framer 에서 새 컴포넌트 생성: \`Marker\`
2. Variant 추가 — 각 마커마다 1개 (Variant key = 문자 자체 또는 의미명)
3. 각 Variant 의 root frame 안에 *문자 1개* (예: \`◎\`) + 작은 라벨 (option)
4. 글꼴/크기/색은 사용자 디자인 결정
5. 페이지에서 layer 삽입할 때 \`Marker\` 컴포넌트 → Variant 선택 → 그 자리에 마커 들어감

→ *데이터에 마커 박지 않고* layer 단위로 따로. 디자인 자유도 + 일관성 확보.

추가 옵션 — markdown list 직접 사용 시 글로벌 CSS 의 \`ul li::before\` 가 \`—\` (em-dash) 자동 부여. 즉:
- *body 안 paragraph 형식 마커* → 위 카탈로그 참고
- *진짜 list 형식* (markdown \`-\`) → 글로벌 CSS 자동
`;

import { writeFileSync, mkdirSync } from 'fs';
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, md);
console.log(`✅ 작성: ${outFile}`);
console.log(`\n샘플 (top 10):`);
sorted.slice(0, 10).forEach(([ch, { count }]) => {
  const name = COMMON_NAMES[ch] || '';
  console.log(`  ${ch}  (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})  ${count}회  ${name}`);
});
