#!/usr/bin/env node
/**
 * copy — 폴더 기반 카피 생성 (md / airtable 통합 진입점).
 *
 * 정신 (사용자 발화 2026-05-26):
 *   - "스크립트는 단지 순서대로 합치는 것 뿐. 폴더 안에 뭘 넣든 사용자 사정"
 *   - "하드코딩이 아니라 폴더로 (SvelteKit 정신)"
 *   - "system 슬롯 폐기 — 전부 user 로. 사용자가 폴더에 '너는 ...' 박으면 그게 시스템"
 *
 * 폴더 컨벤션:
 *   <folder>/
 *   ├── README.md     ← 사람용. 도구 무시.
 *   ├── input/        ← 직속 "숫자 폴더" 만 자연수순. 그 안 .md 알파벳순 concat.
 *   └── output/       ← output_v<NN>.md + output_v<NN>.prompt.md (자동 생성)
 *
 * 사용:
 *   copy                                       # 폴더 메뉴 → md 모드
 *   copy <folder>                              # md 모드
 *   copy <folder> -i "지시"                    # md 모드 + 자유 명령
 *   copy <folder> --target <URL>               # airtable 모드 (인터랙티브)
 *   copy <folder> --target <URL> -i "..."      # airtable 즉시 실행
 *   copy <folder> --ref <URL> --target <URL>   # airtable + reference
 */

import "./lib/freshness.mjs";

import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { homedir } from "os";
import { bold, dim, cyan, green, yellow, red } from "./lib/cli-color.mjs";
import { ensureDoppler } from "./lib/doppler-wrap.mjs";
import { loadInputFolder } from "./lib/copy/input-loader.mjs";
import {
  parseAirtableUrl, fetchSchema, fetchSchemaAndRecords,
  patchRecord, createOrPatchRecords, tableIdByName, compactSchema,
} from "./lib/copy/airtable.mjs";
import { nextVersion, savePrompt, saveSystemPrompt, runClaude, stripCodeFence } from "./lib/copy/runner.mjs";
import { fillAirtableArgs, pickFolder } from "./lib/copy/menu.mjs";
import { parseMultiCsv, writeCsvDir, buildCsvInstruction } from "./lib/copy/csv.mjs";
import { basename } from "path";

const CACHE_DIR = join(homedir(), ".cache", "clavier");
const CACHE_FILE = join(CACHE_DIR, "copy.json");

function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); }
  catch { return { recent: [] }; }
}
function saveCache(c) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

// ── CLI 파싱 ──
const argv = process.argv.slice(2);
const VALUE_OPTS = new Set(["-i", "--instruction", "--target", "--ref", "--model"]);

function arg(name, alias) {
  for (const n of [name, alias].filter(Boolean)) {
    const i = argv.indexOf(n);
    if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) return argv[i + 1];
  }
  return null;
}

function help() {
  console.log(`${bold("copy")} — 폴더 기반 카피 생성 (md / airtable 통합)

${cyan("사용:")}
  copy                                       폴더 메뉴 → md 모드
  copy <folder>                              md 모드 (input/ → output/)
  copy <folder> -i "지시"                    md 모드 + 자유 명령
  copy <folder> --target <URL>               airtable 모드 (인터랙티브 메뉴)
  copy <folder> --target <URL> -i "지시"     airtable 즉시 push
  copy <folder> --ref <URL> --target <URL>   airtable + reference
  copy <folder> --target <URL> --csv         CSV 폴더 출력 (airtableCtl 로 review→upsert)
  copy <folder> --ref <URL> --csv            ref schema 로 CSV 폴더 출력

${cyan("폴더 컨벤션:")}
  <folder>/
  ├── README.md     ← 사람용. 도구 무시.
  ├── input/
  │   ├── 1/        ← 이름이 자연수인 폴더만 봄
  │   ├── 2/        ← 그 안 .md 알파벳순 concat
  │   └── ...       ← 직속 .md / 비-숫자 폴더는 무시
  └── output/       ← output_v<NN>.md + output_v<NN>.prompt.md (자동 생성)

${cyan("정신:")}
  스크립트는 단지 순서대로 합치는 것 뿐. 폴더 안에 뭘 넣든 사용자 사정.
  Layer 1·2·3 슬롯, 어체 락, system head — 코드는 모름. 사용자가 input/ 안 .md 로 표현.

${cyan("동작:")}
  1. input/<숫자>/*.md 자연수순 + 알파벳순 → "\\n\\n" concat (헤딩 없음)
  2. --ref 있으면: 그 Airtable schema + records 자동 fetch → 이어붙임
  3. --target 있으면: 그 Airtable schema fetch → 이어붙임
  4. -i 있으면: 자유 명령 끝에 첨부
  5. 응답 형식 지시:
     - 기본 (--target 없음) → 마크다운 본문
     - --target (base/record) → JSON (PATCH/POST)
     - --csv → 멀티테이블 CSV (airtableCtl 호환)
  6. claude CLI 호출 (system 슬롯 X, 전부 user 로)
  7. 결과:
     - md 모드: output_v<NN>_<model>.md
     - airtable 모드: JSON 파싱 → PATCH/POST + .md 로그
     - csv 모드: output_v<NN>_<model>/<table>.csv (airtableCtl 로 upsert 가능)

${cyan("옵션:")}
  -i, --instruction <text>   자유 명령 (input/ 다음에 첨부)
  --target <URL>             출력 대상 Airtable. rec... 포함 = 단일 record PATCH
  --ref <URL>                참조 Airtable (schema + records 함께)
  --csv                      CSV 모드. push 안 함. airtableCtl 로 review→upsert
  --model <id>               claude 모델 (default: haiku)
  --help, -h                 이 도움말

${cyan("CSV 모드 워크플로우:")}
  copy <folder> --target <URL> --csv
    → output_v<NN>_<model>/<table>.csv 생성 (push X)
  airtableCtl
    → base 선택 → data_dir = 위 폴더 → [1] dry-run → [2] upsert
  ▶ 싸게 iterate: CSV 보고 not bad 면 그때 airtableCtl 로 upsert.

${cyan("인증:")}
  AIRTABLE_PAT  — Doppler clavier/prd 자동 주입 (airtable 모드 시)
  Claude        — claude CLI OAuth (사용자 구독)
`);
}

if (argv.includes("--help") || argv.includes("-h")) { help(); process.exit(0); }

// positional (folder) 추출 — 옵션 값 skip
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("-")) {
    if (VALUE_OPTS.has(a)) i++;
    continue;
  }
  positional.push(a);
}

const folderArg = positional[0];
const instructionArg = arg("--instruction", "-i");
let target = arg("--target");
let ref = arg("--ref");
const MODEL = arg("--model") || "haiku";
const csvMode = argv.includes("--csv");

// ── 폴더 결정 (없으면 메뉴) ──
const cache = loadCache();
let folder = folderArg;
let instruction = instructionArg;

if (!folder) {
  folder = await pickFolder(cache.recent || []);
  if (!folder) { console.log(dim(`중단.`)); process.exit(0); }
}

folder = resolvePath(folder);
if (!existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(red(`✗ 폴더 없음 또는 디렉토리 아님: ${folder}`));
  process.exit(1);
}

// ── 모드 분기 ──
// directPushMode = --target 으로 즉시 PATCH/POST. CSV 면 절대 push X.
// csvMode = --csv. push 안 하고 CSV 파일로 저장. airtableCtl 로 review→upsert.
const directPushMode = !!target && !csvMode;
const needsPat = !!target || !!ref;

if (csvMode && !target && !ref) {
  console.error(red(`✗ --csv 는 --target 또는 --ref 가 있어야 함 (스키마 출처 필요).`));
  process.exit(1);
}

// ── airtable direct push 모드: 인자 부족하면 인터랙티브 ──
if (directPushMode && !instruction) {
  const filled = await fillAirtableArgs({ folder, target, ref, instruction });
  if (!filled) { console.log(dim(`중단.`)); process.exit(0); }
  ({ target, ref, instruction } = filled);
}

// ── Doppler (PAT 필요 시) ──
if (needsPat) {
  ensureDoppler({
    project: "clavier",
    config: "prd",
    sentinelEnv: "_COPY_DOPPLER_INJECTED",
    requiredEnvs: ["AIRTABLE_PAT"],
  });
}

// ── input/ 로드 ──
const inputDir = join(folder, "input");
const { text: inputText, files: inputFiles } = loadInputFolder(inputDir);
if (!existsSync(inputDir)) {
  console.log(yellow(`⚠ ${inputDir} 없음 — input/ 폴더 만들어 .md 자료 박으세요.`));
} else {
  console.log(dim(`input/ — ${inputFiles.length} files, ${Buffer.byteLength(inputText, "utf8")} bytes`));
}

// ── airtable schemas ──
let refData = null;
let targetData = null;
let targetParsed = null;

if (ref) {
  console.log(dim(`fetching reference Airtable...`));
  refData = await fetchSchemaAndRecords(ref, process.env.AIRTABLE_PAT);
  const recCount = Object.values(refData.records).reduce((s, r) => s + r.length, 0);
  console.log(green(`✓ ref`) + dim(`  ${refData.baseId} · ${refData.schema.tables.length} tables · ${recCount} records`));
}
if (target) {
  targetParsed = parseAirtableUrl(target);
  console.log(dim(`fetching target Airtable schema...`));
  targetData = await fetchSchema(target, process.env.AIRTABLE_PAT);
  console.log(
    green(`✓ target`) +
    dim(`  ${targetData.baseId} · ${targetData.schema.tables.length} tables` +
        (targetParsed.recordId ? ` · record=${targetParsed.recordId}` : ""))
  );
}

// ── userPrompt 조립 ──
const parts = [];
if (inputText) parts.push(inputText);

if (refData) {
  parts.push(
    `<reference-airtable url="${ref}" baseId="${refData.baseId}">\n` +
    `<schema>\n${JSON.stringify(compactSchema(refData.schema), null, 2)}\n</schema>\n` +
    `<records>\n${JSON.stringify(refData.records, null, 2)}\n</records>\n` +
    `</reference-airtable>`
  );
}

if (targetData) {
  const mode = targetParsed.recordId ? "record" : "base";
  parts.push(
    `<target-airtable url="${target}" baseId="${targetData.baseId}" mode="${mode}">\n` +
    `<schema>\n${JSON.stringify(compactSchema(targetData.schema), null, 2)}\n</schema>\n` +
    `</target-airtable>`
  );
}

if (instruction) {
  parts.push(`<instruction>\n${instruction}\n</instruction>`);
}

// 응답 형식 지시 — 모드별로 한 번만 (스키마 블록과 분리).
if (csvMode) {
  // schema 우선순위: target > ref
  const csvSchema = targetData?.schema ?? refData?.schema;
  if (targetParsed?.recordId) {
    console.error(red(`✗ --csv 는 base URL 만 지원 (rec... 포함 X).`));
    process.exit(1);
  }
  parts.push(buildCsvInstruction(csvSchema));
} else if (targetData) {
  const mode = targetParsed.recordId ? "record" : "base";
  const formatGuide = mode === "record"
    ? `- 단일 record. { "필드명": 값, ... } 형식. select 옵션은 schema 의 options 안에서 선택.`
    : `- base 통째. { "테이블명": [ { "id"?: "rec...", "fields": { 필드명: 값 } }, ... ] } 형식.\n` +
      `- id 있으면 PATCH (update), 없으면 POST (create). 테이블명은 target schema 의 name 과 정확히 일치해야 함.`;
  parts.push(`응답 형식: 위 target schema 에 맞춰 JSON 단독 출력. 펜스·서두·설명 X.\n${formatGuide}`);
} else {
  parts.push(`응답 형식: 마크다운 본문만. 펜스·서두·설명 X.`);
}

const userPrompt = parts.join("\n\n");

// ── output 경로 + prompt 저장 (claude 실패해도 입력은 남음) ──
const SYSTEM_PROMPT = "";
const outputDir = join(folder, "output");
const { version, mdPath, promptPath, systemPath, csvDir } = nextVersion(outputDir, "output_v", MODEL);
savePrompt(promptPath, userPrompt, MODEL);
saveSystemPrompt(systemPath, SYSTEM_PROMPT, MODEL);

console.log();
console.log(dim(`prompt saved: ${promptPath}  (${Buffer.byteLength(userPrompt, "utf8")}B, ${version})`));
console.log(dim(`→ claude (${MODEL}) 호출 중...`));

// ── claude 호출 ──
const r = await runClaude({ userPrompt, model: MODEL });
console.log(
  green(`✓ claude`) +
  dim(`  ${r.elapsedSec.toFixed(1)}s, ${r.usage.input_tokens ?? "?"}in/${r.usage.output_tokens ?? "?"}out, $${r.totalCostUsd.toFixed(4)}`)
);

if (r.isError) {
  console.error(red(`✗ claude 응답 에러: ${r.errorMessage}`));
  process.exit(1);
}

const responseText = stripCodeFence(r.result);

// ── 결과 처리 ──
if (csvMode) {
  // csv 모드 — 멀티테이블 파싱 후 폴더에 분리 저장. push X.
  const tables = parseMultiCsv(responseText);
  if (Object.keys(tables).length === 0) {
    console.error(red(`✗ CSV 파싱 실패: === <테이블명> === 블록 못 찾음`));
    console.error(dim(`raw 응답 (앞 500자):\n${responseText.slice(0, 500)}`));
    writeFileSync(mdPath, `# CSV 파싱 실패\n\n\`\`\`\n${responseText}\n\`\`\`\n`);
    process.exit(1);
  }
  const written = writeCsvDir(csvDir, tables);
  writeFileSync(
    mdPath,
    `# CSV 출력 (${written.length} tables, ${written.reduce((s, w) => s + w.rows, 0)} rows)\n\n` +
    `data_dir: \`${csvDir}\`\n\n` +
    written.map(w => `- \`${basename(w.path)}\` — ${w.rows} rows`).join("\n") + "\n\n" +
    `## Raw 응답\n\n\`\`\`\n${responseText}\n\`\`\`\n`,
  );
  console.log(green(`✓ CSV`) + dim(`  ${csvDir}/`));
  written.forEach(w => console.log(dim(`    ${basename(w.path)}: ${w.rows} rows`)));
  console.log();
  console.log(`${cyan("→")} airtableCtl ${dim("로 review→upsert:")}`);
  console.log(`  ${green("airtableCtl")}  ${dim(`→ base 선택 → dir=${csvDir} → [1] dry-run → [2] upsert`)}`);
} else if (!targetData) {
  // md 모드
  writeFileSync(mdPath, responseText);
  console.log(green(`✓ saved`) + dim(`  ${mdPath}`));
} else {
  // airtable 모드 — JSON 파싱 + push
  let payload;
  try { payload = JSON.parse(responseText); }
  catch (e) {
    console.error(red(`✗ JSON 파싱 실패: ${e.message}`));
    console.error(dim(`raw 응답 (앞 500자):\n${responseText.slice(0, 500)}`));
    writeFileSync(mdPath, `# JSON 파싱 실패\n\n\`\`\`\n${responseText}\n\`\`\`\n`);
    process.exit(1);
  }
  writeFileSync(
    mdPath,
    `# Airtable push (${targetParsed.recordId ? "record" : "base"} mode)\n\n` +
    `target: ${target}\n\n` +
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`,
  );

  if (targetParsed.recordId) {
    // 단일 record PATCH
    await patchRecord({
      baseId: targetData.baseId,
      tableId: targetParsed.tableId,
      recordId: targetParsed.recordId,
      fields: payload,
      pat: process.env.AIRTABLE_PAT,
    });
    console.log(
      green(`✓ Airtable PATCH`) +
      dim(`  ${targetData.baseId}/${targetParsed.tableId}/${targetParsed.recordId}`),
    );
  } else {
    // base 통째 — 테이블별 records
    if (typeof payload !== "object" || Array.isArray(payload)) {
      console.error(red(`✗ base 모드는 { "테이블명": [...records...] } 형식 필요. 받은: ${typeof payload}`));
      process.exit(1);
    }
    for (const [tableName, records] of Object.entries(payload)) {
      const tableId = tableIdByName(targetData.schema, tableName);
      if (!tableId) {
        console.log(yellow(`⚠ 테이블 '${tableName}' 없음 — skip`));
        continue;
      }
      if (!Array.isArray(records)) {
        console.log(yellow(`⚠ '${tableName}' 값이 array 아님 — skip`));
        continue;
      }
      const r = await createOrPatchRecords({
        baseId: targetData.baseId,
        tableId,
        records,
        pat: process.env.AIRTABLE_PAT,
      });
      console.log(green(`✓ ${tableName}`) + dim(`  patched=${r.patched} created=${r.created}`));
    }
  }
}

// ── cache 갱신 ──
cache.recent = (cache.recent || []).filter(x => x.path !== folder);
cache.recent.unshift({ path: folder, at: new Date().toISOString() });
if (cache.recent.length > 10) cache.recent.length = 10;
saveCache(cache);

console.log();
console.log(dim(`version: ${version}`));
console.log(dim(`output:  ${csvMode ? csvDir + "/" : mdPath}`));
console.log(dim(`prompt:  ${promptPath}`));
console.log(dim(`system:  ${systemPath}`));
