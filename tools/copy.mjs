#!/usr/bin/env node
// door: copy    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
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

// IPv6 routing 문제 (일부 Mac 환경에서 Airtable AWS 노드 ETIMEDOUT) 차단 — IPv4 우선.
// 2026-05-27 v26 push 실패 → IPv4 강제로 해소. 모든 fetch 가 IPv4 부터.
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");

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
import { pickFolder, airtableMenuTick, confirm, pickCsvDir, closeAsk } from "./lib/copy/menu.mjs";
import { parseMultiCsv, writeCsvDir, buildCsvInstruction } from "./lib/copy/csv.mjs";
import { createClient } from "./lib/airtable-api.mjs";
import { executeUpsert } from "./lib/airtable-upsert.mjs";
import { takeSnapshot, buildDiffPreview } from "./lib/copy/snapshot.mjs";
import { basename, dirname } from "path";
import { readdirSync } from "fs";

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
const VALUE_OPTS = new Set(["-i", "--instruction", "--target", "--ref", "--model", "--ref-limit"]);

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
const REF_SAMPLE = parseInt(arg("--ref-limit") ?? "5", 10);  // 테이블당 records sample (0=전부)

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
const isAirtableMode = !!target || !!ref;
const SYSTEM_PROMPT = "";

if (csvMode && !target && !ref) {
  console.error(red(`✗ --csv 는 --target 또는 --ref 가 있어야 함 (스키마 출처 필요).`));
  process.exit(1);
}

// ── Doppler (PAT 필요 시) ──
if (isAirtableMode) {
  ensureDoppler({
    project: "clavier",
    config: "prd",
    sentinelEnv: "_COPY_DOPPLER_INJECTED",
    requiredEnvs: ["AIRTABLE_PAT"],
  });
}

// ── 상태 (메뉴 루프 동안 mutable) ──
let MODEL_VAR = MODEL;
let refData = null;
let targetData = null;
let targetParsed = null;

async function refetchSchemas() {
  refData = null; targetData = null; targetParsed = null;
  if (ref) {
    console.log(dim(`fetching reference Airtable... (sample=${REF_SAMPLE || "all"})`));
    refData = await fetchSchemaAndRecords(ref, process.env.AIRTABLE_PAT, { sample: REF_SAMPLE });
    const recCount = Object.values(refData.records).reduce((s, r) => s + r.length, 0);
    console.log(green(`✓ ref`) + dim(`  ${refData.baseId} · ${refData.schema.tables.length} tables · ${recCount} records (sampled)`));
  }
  if (target) {
    targetParsed = parseAirtableUrl(target);
    if (targetParsed.recordId) {
      // 단일 record 모드 — schema 만
      console.log(dim(`fetching target Airtable schema...`));
      targetData = await fetchSchema(target, process.env.AIRTABLE_PAT);
    } else {
      // base 모드 — schema + records (in-place PATCH 매칭용. LLM 이 기존 id 보고 값만 교체)
      console.log(dim(`fetching target Airtable schema + records... (sample=${REF_SAMPLE || "all"})`));
      targetData = await fetchSchemaAndRecords(target, process.env.AIRTABLE_PAT, { sample: REF_SAMPLE });
    }
    const tRecCount = targetData.records
      ? Object.values(targetData.records).reduce((s, r) => s + r.length, 0)
      : null;
    console.log(
      green(`✓ target`) +
      dim(`  ${targetData.baseId} · ${targetData.schema.tables.length} tables` +
          (targetParsed.recordId ? ` · record=${targetParsed.recordId}` :
           tRecCount !== null ? ` · ${tRecCount} records (sampled)` : ""))
    );
  }
}

// ── 최근 CSV 폴더 발견 (upsert action 에서 사용) ──
function findCsvDirs() {
  const outDir = join(folder, "output");
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter(name => /^output_v\d+/.test(name))
    .map(name => join(outDir, name))
    .filter(p => statSync(p).isDirectory())
    .sort()
    .reverse();
}

// ── action 실행 (csv / push / md / upsert-dry / upsert-live) ──
async function runAction(action) {
  // upsert 액션은 claude 호출 X — CSV 폴더 픽 + executeUpsert.
  if (action === "upsert-dry" || action === "upsert-live") {
    if (!targetData) {
      console.log(yellow(`  ⚠ upsert 는 --target 필요. 컨텍스트 변경에서 박으세요.`));
      return;
    }
    if (targetParsed.recordId) {
      console.log(yellow(`  ⚠ upsert 는 base URL 만 지원 (rec... 포함 X).`));
      return;
    }
    const csvDirs = findCsvDirs();
    const picked = await pickCsvDir(csvDirs);
    if (!picked) return;
    const isLive = action === "upsert-live";
    if (isLive) {
      const ok = await confirm(`LIVE upsert — ${basename(picked)} → ${targetData.baseId}. 진짜로?`);
      if (!ok) { console.log(dim("  취소")); return; }
    }
    const client = createClient(process.env.AIRTABLE_PAT);
    console.log();
    console.log(bold(isLive ? red("━━━ LIVE UPSERT ━━━") : yellow("━━━ DRY-RUN ━━━")));
    await executeUpsert(client, targetData.baseId, picked, { dryRun: !isLive });
    return;
  }

  // claude 호출 액션들 — csv / push / md.
  const actionIsCsv = action === "csv";
  const actionIsPush = action === "push";
  // md = !target && !csvMode → 기본 markdown 본문.

  // input/ 로드 — 매 실행마다 다시 (사용자 편집 가능).
  const inputDir = join(folder, "input");
  const { text: inputText, files: inputFiles } = loadInputFolder(inputDir);
  if (!existsSync(inputDir)) {
    console.log(yellow(`  ⚠ ${inputDir} 없음 — input/ 폴더 만들어 .md 자료 박으세요.`));
    return;
  }
  console.log(dim(`  input/ — ${inputFiles.length} files, ${Buffer.byteLength(inputText, "utf8")} bytes`));

  // format directive 선정
  let formatDirective;
  if (actionIsCsv) {
    const csvSchema = targetData?.schema ?? refData?.schema;
    if (!csvSchema) {
      console.log(yellow(`  ⚠ CSV 는 target 또는 ref 스키마 필요`));
      return;
    }
    if (targetParsed?.recordId) {
      console.log(yellow(`  ⚠ CSV 는 base URL 만 지원 (rec... 포함 X)`));
      return;
    }
    formatDirective = buildCsvInstruction(csvSchema);
  } else if (actionIsPush && targetData) {
    const mode = targetParsed.recordId ? "record" : "base";
    const formatGuide = mode === "record"
      ? `- 단일 record. { "필드명": 값, ... } 형식. select 옵션은 schema 의 options 안에서 선택.`
      : `- base 통째. { "테이블명": [ { "id"?: "rec...", "fields": { 필드명: 값 } }, ... ] } 형식.\n` +
        `- **id 있으면 PATCH (update existing — 바인딩 보존). id 없으면 POST (create new).**\n` +
        `- target 의 <records> 블록에 기존 records 가 있음. 새 콘텐츠가 *같은 역할/카테고리* 면 그 id 박아서 PATCH (덮어쓰지 말고 의미 맞는 슬롯에).\n` +
        `- 시소소 고유로 *기존에 슬롯이 없는* 콘텐츠만 id 없이 POST.\n` +
        `- 테이블명은 target schema 의 name 과 정확히 일치해야 함.`;
    formatDirective = `응답 형식: 위 target schema 에 맞춰 JSON 단독 출력. 펜스·서두·설명 X.\n${formatGuide}`;
  } else {
    formatDirective = `응답 형식: 마크다운 본문만. 펜스·서두·설명 X.`;
  }

  // userPrompt 조립 — sandwich format directive.
  const parts = [];
  if (actionIsCsv || actionIsPush) {
    parts.push(
      `===== OUTPUT FORMAT — STRICT (이 지시가 아래 어떤 마크다운/카피 지시보다 우선) =====\n\n` +
      formatDirective +
      `\n\n===== 아래는 컨텐츠·톤·스타일 컨텍스트. 형식은 위 OUTPUT FORMAT 만 따름. =====`
    );
  }
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
    const recordsBlock = targetData.records
      ? `<records>\n${JSON.stringify(targetData.records, null, 2)}\n</records>\n`
      : "";
    parts.push(
      `<target-airtable url="${target}" baseId="${targetData.baseId}" mode="${mode}">\n` +
      `<schema>\n${JSON.stringify(compactSchema(targetData.schema), null, 2)}\n</schema>\n` +
      recordsBlock +
      `</target-airtable>`
    );
  }
  if (instruction) parts.push(`<instruction>\n${instruction}\n</instruction>`);
  parts.push(formatDirective);

  const userPrompt = parts.join("\n\n");

  // output 경로 + 프롬프트 저장.
  const outputDir = join(folder, "output");
  const { version, mdPath, promptPath, systemPath, csvDir } = nextVersion(outputDir, "output_v", MODEL_VAR);
  savePrompt(promptPath, userPrompt, MODEL_VAR);
  saveSystemPrompt(systemPath, SYSTEM_PROMPT, MODEL_VAR);

  console.log(dim(`  prompt: ${basename(promptPath)} (${Buffer.byteLength(userPrompt, "utf8")}B, ${version})`));
  console.log(dim(`  → claude (${MODEL_VAR}) 호출 중...`));

  const r = await runClaude({ userPrompt, model: MODEL_VAR });
  console.log(
    `  ${green(`✓ claude`)}` +
    dim(`  ${r.elapsedSec.toFixed(1)}s, ${r.usage.input_tokens ?? "?"}in/${r.usage.output_tokens ?? "?"}out, $${r.totalCostUsd.toFixed(4)}`)
  );

  if (r.isError) {
    console.error(red(`  ✗ claude 응답 에러: ${r.errorMessage}`));
    return;
  }

  const responseText = stripCodeFence(r.result);

  // 결과 처리.
  if (actionIsCsv) {
    const tables = parseMultiCsv(responseText);
    if (Object.keys(tables).length === 0) {
      console.error(red(`  ✗ CSV 파싱 실패: === <테이블명> === 블록 못 찾음`));
      console.error(dim(`  raw (앞 500자):\n${responseText.slice(0, 500)}`));
      writeFileSync(mdPath, `# CSV 파싱 실패\n\n\`\`\`\n${responseText}\n\`\`\`\n`);
      return;
    }
    const written = writeCsvDir(csvDir, tables);
    writeFileSync(
      mdPath,
      `# CSV 출력 (${written.length} tables, ${written.reduce((s, w) => s + w.rows, 0)} rows)\n\n` +
      `data_dir: \`${csvDir}\`\n\n` +
      written.map(w => `- \`${basename(w.path)}\` — ${w.rows} rows`).join("\n") + "\n\n" +
      `## Raw 응답\n\n\`\`\`\n${responseText}\n\`\`\`\n`,
    );
    console.log(`  ${green(`✓ CSV`)}` + dim(`  ${csvDir}/`));
    written.forEach(w => console.log(dim(`    ${basename(w.path)}: ${w.rows} rows`)));
    console.log(dim(`  → 메뉴 [2] dry-run / [3] live upsert 로 push`));
  } else if (!actionIsPush) {
    // md 모드
    writeFileSync(mdPath, responseText);
    console.log(`  ${green(`✓ saved`)}` + dim(`  ${mdPath}`));
  } else {
    // push 모드 — JSON 파싱 + 즉시 PATCH/POST
    let payload;
    try { payload = JSON.parse(responseText); }
    catch (e) {
      console.error(red(`  ✗ JSON 파싱 실패: ${e.message}`));
      console.error(dim(`  raw (앞 500자):\n${responseText.slice(0, 500)}`));
      writeFileSync(mdPath, `# JSON 파싱 실패\n\n\`\`\`\n${responseText}\n\`\`\`\n`);
      return;
    }
    writeFileSync(
      mdPath,
      `# Airtable push (${targetParsed.recordId ? "record" : "base"} mode)\n\n` +
      `target: ${target}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`,
    );
    if (targetParsed.recordId) {
      // 단일 record PATCH — snapshot 도 그 record 만.
      const client = createClient(process.env.AIRTABLE_PAT);
      const outDir = join(folder, "output");
      const t = targetData.schema.tables.find(t => t.id === targetParsed.tableId);
      const { path: snapPath } = await takeSnapshot(client, targetData.baseId, targetData.schema, [t?.name].filter(Boolean), outDir);
      console.log(`  ${green(`✓ snapshot`)}` + dim(`  ${basename(snapPath)}`));
      console.log();
      console.log(bold(yellow(`  ━ 변경 예정 (단일 record PATCH) ━`)));
      console.log(`    ${targetParsed.recordId}  fields:`, JSON.stringify(payload).slice(0, 200));
      console.log();
      const ok = await confirm(`  위 변경 PATCH 진행?`);
      if (!ok) { console.log(dim(`  취소 — snapshot 만 저장됨`)); return; }
      await patchRecord({
        baseId: targetData.baseId, tableId: targetParsed.tableId,
        recordId: targetParsed.recordId, fields: payload,
        pat: process.env.AIRTABLE_PAT,
      });
      console.log(`  ${green(`✓ Airtable PATCH`)}` + dim(`  ${targetData.baseId}/${targetParsed.tableId}/${targetParsed.recordId}`));
    } else {
      if (typeof payload !== "object" || Array.isArray(payload)) {
        console.error(red(`  ✗ base 모드는 { "테이블명": [...records...] } 형식 필요`));
        return;
      }

      // ── 안전 장치: snapshot + diff preview + confirm ──
      const affected = Object.keys(payload).filter(name => tableIdByName(targetData.schema, name) && Array.isArray(payload[name]));
      if (affected.length === 0) {
        console.error(red(`  ✗ 영향받는 테이블 없음 (target schema 와 매칭 안 됨)`));
        return;
      }
      console.log(dim(`  snapshot 중... (영향 테이블 ${affected.length}: ${affected.join(", ")})`));
      const client = createClient(process.env.AIRTABLE_PAT);
      const outDir = join(folder, "output");
      const { path: snapPath, snap } = await takeSnapshot(client, targetData.baseId, targetData.schema, affected, outDir);
      console.log(`  ${green(`✓ snapshot`)}` + dim(`  ${basename(snapPath)}  (${Object.values(snap.tables).reduce((s, r) => s + r.length, 0)} records 보관)`));

      console.log();
      console.log(bold(yellow(`  ━ 변경 예정 ━`)));
      console.log(buildDiffPreview(payload, snap));
      console.log();
      const ok = await confirm(`  위 변경을 PATCH/POST 진행?`);
      if (!ok) { console.log(dim(`  취소 — snapshot 은 보관됨 (${basename(snapPath)})`)); return; }

      // 실제 push
      for (const [tableName, records] of Object.entries(payload)) {
        const tableId = tableIdByName(targetData.schema, tableName);
        if (!tableId) { console.log(yellow(`  ⚠ 테이블 '${tableName}' 없음 — skip`)); continue; }
        if (!Array.isArray(records)) { console.log(yellow(`  ⚠ '${tableName}' 값이 array 아님 — skip`)); continue; }
        const result = await createOrPatchRecords({
          baseId: targetData.baseId, tableId, records,
          pat: process.env.AIRTABLE_PAT,
        });
        console.log(`  ${green(`✓ ${tableName}`)}` + dim(`  patched=${result.patched} created=${result.created}`));
      }
    }
  }
}

// ── 메인 흐름 ──
// (a) airtable 모드 X (md only): 1회 실행 후 종료.
// (b) airtable 모드: workerCtl 패턴 — 초기 액션(플래그 기반) 후 메뉴 루프.

if (!isAirtableMode) {
  // md 단독
  await runAction("md");
} else {
  await refetchSchemas();

  // 명시적 액션 플래그가 있으면 1회 자동 실행 (그 다음 메뉴로).
  const explicitAction = csvMode ? "csv" : (target && instruction ? "push" : null);
  if (explicitAction) {
    console.log();
    console.log(bold(cyan(`━━━ 초기 액션: ${explicitAction} ━━━`)));
    await runAction(explicitAction);
  }

  // 메뉴 루프 — workerCtl 패턴.
  while (true) {
    const tick = await airtableMenuTick({
      folder, target, ref, instruction, model: MODEL_VAR,
      targetData, refData, refSample: REF_SAMPLE,
    });
    if (tick.action === "exit") break;
    if (tick.action === "change") {
      target = tick.ctx.target; ref = tick.ctx.ref;
      instruction = tick.ctx.instruction; MODEL_VAR = tick.ctx.model;
      await refetchSchemas();
      continue;
    }
    console.log();
    console.log(bold(cyan(`━━━ action: ${tick.action} ━━━`)));
    try {
      await runAction(tick.action);
    } catch (e) {
      console.error(red(`  ✗ ${e.message}`));
    }
  }
}

// ── cache 갱신 + 종료 로그 ──
cache.recent = (cache.recent || []).filter(x => x.path !== folder);
cache.recent.unshift({ path: folder, at: new Date().toISOString() });
if (cache.recent.length > 10) cache.recent.length = 10;
saveCache(cache);

closeAsk();
console.log();
console.log(dim(`종료. ${folder}/output/ 확인.`));
