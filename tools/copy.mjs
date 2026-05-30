#!/usr/bin/env node
/**
 * copy — 폴더 기반 카피 대화 (읽기 ≠ 쓰기, 대화형).
 *
 * 정신:
 *   - "스크립트는 단지 순서대로 합치는 것 뿐. 폴더 안에 뭘 넣든 사용자 사정" (2026-05-26)
 *   - "system 슬롯 폐기 — 전부 user 로" (2026-05-26)
 *   - 읽기(input/ + model base + project base) ≠ 쓰기(어디다 쓸지는 대화 중 :out 으로) (2026-05-29)
 *
 * 받는 건 다 "읽기": input/ 폴더(디렉션) + --model-base(참고·모범) + --project-base(프로젝트).
 * "어디다 쓸지" 는 호출 때 안 정함 — 대화하다 :out 메뉴로 그때그때
 * (1 에어테이블=프로젝트 base / 2 마크다운 / 3 표 CSV). 큰 목적지만 메뉴, 디테일은 대화로.
 *
 * 폴더 컨벤션:
 *   <folder>/
 *   ├── README.md     ← 사람용. 도구 무시.
 *   ├── input/        ← 직속 "숫자 폴더" 만 자연수순. 그 안 .md 알파벳순 concat.
 *   └── output/       ← session_v<NN>.md(전사) · output_v<NN>.{md,csv,json}(산출물)
 *
 * 사용:
 *   copy                                                 # 폴더 메뉴 → 대화
 *   copy <folder>                                        # 대화 (input/ 만)
 *   copy <folder> --model-base <URL> --project-base <URL># 두 base 읽고 대화
 *   copy <folder> ... -i "첫 지시"                        # 첫 턴을 미리 채워 대화 시작
 */

import "./lib/freshness.mjs";

import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { bold, dim, cyan, green, yellow, red } from "./lib/cli-color.mjs";
import { ensureDoppler } from "./lib/doppler-wrap.mjs";
import { loadInputFolder } from "./lib/copy/input-loader.mjs";
import { fetchSchemaAndRecords, compactSchema } from "./lib/copy/airtable.mjs";
import { savePrompt, nextNumbered } from "./lib/copy/runner.mjs";
import { pickFolder } from "./lib/copy/menu.mjs";
import { runRepl } from "./lib/copy/repl.mjs";

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
const VALUE_OPTS = new Set(["-i", "--instruction", "--model-base", "--project-base", "--model"]);

function arg(name, alias) {
  for (const n of [name, alias].filter(Boolean)) {
    const i = argv.indexOf(n);
    if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) return argv[i + 1];
  }
  return null;
}

function help() {
  console.log(`${bold("copy")} — 폴더 기반 카피 대화 (읽기 ≠ 쓰기)

${cyan("사용:")}
  copy                                                  폴더 메뉴 → 대화
  copy <folder>                                         대화 (input/ 만 읽음)
  copy <folder> --model-base <URL> --project-base <URL> 두 base 읽고 대화
  copy <folder> ... -i "첫 지시"                         첫 턴 미리 채워 시작

${cyan("받는 건 다 \"읽기\":")}
  input/        디렉션 (숫자 폴더 안 .md 자연수+알파벳순 concat)
  --model-base  참고·모범 Airtable (읽기 전용)
  --project-base 프로젝트 Airtable (읽기 + 에어테이블 출력 시 이 base 에 씀)

${cyan("\"어디다 쓸지\" 는 대화 중 :out 으로:")}
  :out → 1 에어테이블 (프로젝트 base 에 push)
         2 마크다운    (output_vNN.md)
         3 표 CSV      (output_vNN.csv)
  큰 목적지만 결정적 메뉴. 어느 record·필드인지 같은 디테일은 대화로 말하면 됨.
  :exit / Ctrl-D 칠 때까지 대화는 안 끝남. 전 대화는 output/session_vNN.md 에 실시간 기록.

${cyan("폴더 컨벤션:")}
  <folder>/input/<숫자>/*.md   ← 자연수 폴더순 + 알파벳 파일순, "\\n\\n" concat. _ 접두사 무시.
  <folder>/output/             ← session_v<NN>.md(전사) · output_v<NN>.{md,csv,json}

${cyan("옵션:")}
  -i, --instruction <text>   첫 턴을 미리 채움 (없으면 빈 대화로 시작)
  --model-base <URL>         참고 Airtable (schema + records 읽기)
  --project-base <URL>       프로젝트 Airtable (읽기 + 에어테이블 출력 대상)
  --model <id>               claude 모델 (default: haiku — 품질은 sonnet 권장)
  --help, -h                 이 도움말

${cyan("인증:")}
  AIRTABLE_PAT  — Doppler clavier/prd 자동 주입 (base 인자 있을 때)
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
const modelBaseUrl = arg("--model-base");
const projectBaseUrl = arg("--project-base");
const MODEL = arg("--model") || "haiku";

// ── 폴더 결정 (없으면 메뉴) ──
const cache = loadCache();
let folder = folderArg;

if (!folder) {
  folder = await pickFolder(cache.recent || []);
  if (!folder) { console.log(dim(`중단.`)); process.exit(0); }
}

folder = resolvePath(folder);
if (!existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(red(`✗ 폴더 없음 또는 디렉토리 아님: ${folder}`));
  process.exit(1);
}

// ── Doppler (base 인자 있으면 PAT 필요 — 읽기에도 필요) ──
if (modelBaseUrl || projectBaseUrl) {
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

// ── base 읽기 (둘 다 schema + records) ──
let modelData = null;
let projectData = null;

if (modelBaseUrl) {
  console.log(dim(`fetching model (참고) base...`));
  modelData = await fetchSchemaAndRecords(modelBaseUrl, process.env.AIRTABLE_PAT);
  const n = Object.values(modelData.records).reduce((s, r) => s + r.length, 0);
  console.log(green(`✓ model-base`) + dim(`  ${modelData.baseId} · ${modelData.schema.tables.length} tables · ${n} records`));
}
if (projectBaseUrl) {
  console.log(dim(`fetching project base...`));
  projectData = await fetchSchemaAndRecords(projectBaseUrl, process.env.AIRTABLE_PAT);
  const n = Object.values(projectData.records).reduce((s, r) => s + r.length, 0);
  console.log(green(`✓ project-base`) + dim(`  ${projectData.baseId} · ${projectData.schema.tables.length} tables · ${n} records`));
}

// ── 1턴째 컨텍스트 조립 ──
const parts = [];
if (inputText) parts.push(inputText);

if (modelData) {
  parts.push(
    `<model-airtable url="${modelBaseUrl}" baseId="${modelData.baseId}" role="참고·모범 (읽기 전용)">\n` +
    `<schema>\n${JSON.stringify(compactSchema(modelData.schema), null, 2)}\n</schema>\n` +
    `<records>\n${JSON.stringify(modelData.records, null, 2)}\n</records>\n` +
    `</model-airtable>`
  );
}
if (projectData) {
  parts.push(
    `<project-airtable url="${projectBaseUrl}" baseId="${projectData.baseId}" role="프로젝트 (읽기 + 에어테이블 출력 시 이 base 에 씀)">\n` +
    `<schema>\n${JSON.stringify(compactSchema(projectData.schema), null, 2)}\n</schema>\n` +
    `<records>\n${JSON.stringify(projectData.records, null, 2)}\n</records>\n` +
    `</project-airtable>`
  );
}

if (instructionArg) {
  parts.push(`<instruction>\n${instructionArg}\n</instruction>\n\n위 자료를 바탕으로 작업을 시작해.`);
} else {
  parts.push(`위 자료를 다 읽었으면 "준비됨" 한 마디만 답하고 내 지시를 기다려.`);
}
parts.push(`(평소엔 마크다운 본문/대화로 답해. CSV·에어테이블 반영용 직렬화는 내가 :out 고를 때 따로 요청한다.)`);

const firstPrompt = parts.join("\n\n");

// ── output 경로 + 1턴 컨텍스트 떠두기 (감사·재현) ──
const outputDir = join(folder, "output");
const { version, path: sessionPath } = nextNumbered(outputDir, "session_v", ".md");
const contextPath = sessionPath.replace(/\.md$/, ".context.md");
savePrompt(contextPath, firstPrompt, MODEL);

const sessionId = randomUUID();
console.log();
console.log(dim(`session ${version} · model ${MODEL} · context ${Buffer.byteLength(firstPrompt, "utf8")}B`));
console.log(dim(`전사 → ${sessionPath}`));

// ── 대화 ──
await runRepl({
  model: MODEL,
  sessionId,
  firstPrompt,
  outputDir,
  sessionPath,
  projectBase: projectData,
  pat: process.env.AIRTABLE_PAT || null,
});

// ── cache 갱신 ──
cache.recent = (cache.recent || []).filter(x => x.path !== folder);
cache.recent.unshift({ path: folder, at: new Date().toISOString() });
if (cache.recent.length > 10) cache.recent.length = 10;
saveCache(cache);
