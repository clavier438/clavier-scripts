// csv — 멀티테이블 CSV 파싱 + 파일 쓰기 (airtableCtl 호환).
//
// LLM 응답 포맷:
//   === <테이블명> ===
//   header1,header2,header3
//   v1,v2,v3
//
//   === <다음 테이블> ===
//   ...
//
// → airtableCtl data_dir 구조와 동일: 폴더 안 <테이블>.csv 파일.

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// airtableCtl 의 COMPUTED_TYPES — 채울 수 없는 필드. CSV 에 박지 마.
const COMPUTED_TYPES = new Set([
  "formula", "multipleLookupValues", "rollup", "count",
  "autoNumber", "createdTime", "lastModifiedTime",
  "createdBy", "lastModifiedBy", "button",
]);

/**
 * "=== table === \n csv body" 형식 → { tableName: csvString }
 *
 * 견고하게: 코드펜스 안에 들어있어도 OK (stripCodeFence 후 호출).
 * 빈 줄·앞뒤 공백 무시. 테이블명 trim.
 */
export function parseMultiCsv(text) {
  const tables = {};
  // === <name> === 를 헤더 줄로 매칭, 다음 === 까지가 body.
  const re = /^===\s*(.+?)\s*===\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ name: m[1].trim(), start: m.index, headerEnd: m.index + m[0].length });
  }
  if (matches.length === 0) return tables;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].headerEnd;
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const body = text.slice(start, end).trim();
    if (body) tables[matches[i].name] = body + "\n";
  }
  return tables;
}

/**
 * { tableName: csvString } → <dir>/<table>.csv 파일들로 저장.
 *
 * @returns [{name, path, rows}]
 */
export function writeCsvDir(dir, tables) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, csv] of Object.entries(tables)) {
    const safe = name.replace(/[\/\\]/g, "_");
    const path = join(dir, `${safe}.csv`);
    writeFileSync(path, csv);
    written.push({ name, path, rows: countCsvRows(csv) });
  }
  return written;
}

/**
 * RFC 4180-aware row count — 따옴표 안 줄바꿈은 같은 row.
 * 헤더 제외.
 */
function countCsvRows(text) {
  let rows = 0, inQuote = false, sawContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuote && text[i + 1] === '"') { i++; continue; }
      inQuote = !inQuote;
    } else if (c === "\n" && !inQuote) {
      if (sawContent) rows++;
      sawContent = false;
    } else if (c !== "\r" && c.trim() !== "") {
      sawContent = true;
    }
  }
  if (sawContent) rows++;  // EOF 직전 마지막 row
  return Math.max(0, rows - 1);  // -1 = header
}

/**
 * 프롬프트용 CSV 포맷 지시문 — schema 의 테이블/필드를 airtableCtl 규칙대로 나열.
 *
 * @param schema  Airtable schema ({tables: [{name, fields: [{name, type, options?}]}]})
 */
export function buildCsvInstruction(schema) {
  const tableSpecs = schema.tables.map(t => {
    const cols = t.fields
      .filter(f => !COMPUTED_TYPES.has(f.type))
      .map(f => {
        const note =
          f.type === "multipleRecordLinks" ? ` (link → ${linkTargetName(f, schema)} slugKey, |구분)` :
          f.type === "multipleSelects"     ? " (|구분)" :
          f.type === "singleSelect"        ? ` (옵션: ${selectOptions(f)})` :
          f.type === "checkbox"            ? " (true/false)" :
          f.type === "multipleAttachments" ? " (URL, |구분)" :
          "";
        return `${f.name}${note}`;
      });
    return `  - ${t.name}: ${cols.join(", ")}`;
  }).join("\n");

  return `응답 형식: 멀티테이블 CSV (airtableCtl 호환).

각 테이블 앞에 \`=== <테이블명> ===\` 헤더 한 줄. 다음 줄부터 RFC 4180 CSV.
- 헤더 = 필드명 그대로 (대소문자·공백 포함 정확히).
- **slugKey 컬럼 필수** — 영문 stable key (예: \`room_jeongon\`, \`tag_food\`). 같은 키 = 같은 record 로 upsert.
- 빈 셀 = 기존값 유지 (안 채워도 OK).
- multipleSelects / multipleRecordLinks = "|" 구분.
- multipleRecordLinks 값 = target 테이블의 slugKey ("|" 로 여러 개).
- checkbox = "true" / "false".
- formula / lookup / autoNumber / rollup / createdTime / lastModifiedTime / createdBy / lastModifiedBy / button 컬럼은 박지 마 (자동 skip 되지만 토큰 낭비).
- 값에 쉼표·줄바꿈·따옴표 있으면 RFC 4180 쌍따옴표 escape.

채울 수 있는 컬럼 (target/ref schema 기준):
${tableSpecs}

예시:
=== topics ===
slugKey,name
t_room,룸

=== items ===
slugKey,name,topic,tags
i_jeongon,"정온재 — 고요한 온기",t_room,"theme-sea|season-spring"

펜스·서두·설명 X. CSV 본문만.`;
}

function linkTargetName(f, schema) {
  const tid = f.options?.linkedTableId;
  if (!tid) return "?";
  const t = schema.tables.find(t => t.id === tid);
  return t ? t.name : "?";
}

function selectOptions(f) {
  const choices = f.options?.choices || [];
  return choices.map(c => c.name).join(" / ") || "?";
}
