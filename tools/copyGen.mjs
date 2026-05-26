#!/usr/bin/env node
/**
 * copyGen — Airtable record 카피 자동 생성 (claude CLI · 사용자 구독)
 *
 * 사용법:
 *   copyGen                            # 인터랙티브 (메뉴)
 *   copyGen <URL>                      # 자동 preview → PATCH 확인
 *   copyGen <URL> --yolo               # 확인 없이 즉시 PATCH
 *   copyGen <URL> --fields name,notes  # 특정 필드만
 *   copyGen <URL> --brand <name>       # Layer 2 파일 이름 (default: cache)
 *
 * 옵션:
 *   --brand <name>      Layer 2 → copy-layers/2-brand/{name}.md
 *   --section <name>    Layer 3 → copy-layers/3-section/{name}.md (optional)
 *   --fields f1,f2      특정 필드만 (default: 비어 있는 텍스트 필드 모두)
 *   --diff              기존 vs 새 값 비교 출력
 *   --yolo              확인 없이 PATCH (CI/batch)
 *   --model <id>        Claude 모델 alias (default: sonnet)
 *
 * 인증:
 *   AIRTABLE_PAT  — Doppler clavier/prd 자동 주입
 *   Claude        — claude CLI OAuth (사용자 구독)
 */

import "./lib/freshness.mjs";

import { createInterface } from "readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { ensureDoppler } from "./lib/doppler-wrap.mjs";
import { bold, dim, cyan, green, yellow, red, gray } from "./lib/cli-color.mjs";
import { createAirtableSource } from "./lib/copy/adapters/airtable-source.mjs";
import { generatePatchForRecord, applyPatch } from "./lib/copy/use-cases/patch-record.mjs";

ensureDoppler({
  project: "clavier",
  config: "prd",
  sentinelEnv: "_COPY_GEN_DOPPLER_INJECTED",
  requiredEnvs: ["AIRTABLE_PAT"],
});

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const LAYERS_DIR = join(REPO_ROOT, "copy-layers");
const LAYER_DIRS = {
  core: join(LAYERS_DIR, "1-core"),
  brand: join(LAYERS_DIR, "2-brand"),
  section: join(LAYERS_DIR, "3-section"),
};
const CACHE_DIR = join(homedir(), ".cache", "clavier");
const CACHE_FILE = join(CACHE_DIR, "copyGen.json");

function listOptions(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, "")).sort();
}

function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); }
  catch { return { brand: "mukayu", section: null, recent: [] }; }
}
function saveCache(c) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}
function pushRecent(cache, entry, max = 5) {
  const i = cache.recent.findIndex(r => r.url === entry.url);
  if (i >= 0) cache.recent.splice(i, 1);
  cache.recent.unshift(entry);
  if (cache.recent.length > max) cache.recent.length = max;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, a => r(a.trim())));

// ── CLI 파싱
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`${bold("copyGen")} — Airtable record 카피 자동 생성

${cyan("사용:")}
  copyGen                            # 인터랙티브 (메뉴)
  copyGen <URL>                      # 자동 preview → PATCH 확인
  copyGen <URL> --yolo               # 확인 없이 즉시 PATCH
  copyGen <URL> --fields name,notes  # 특정 필드만
  copyGen <URL> --brand <name>       # Layer 2 (default: cache)

${cyan("옵션:")}
  --brand <name>      Layer 2 → copy-layers/2-brand/{name}.md
  --section <name>    Layer 3 → copy-layers/3-section/{name}.md
  --fields f1,f2      특정 필드만
  --diff              기존 vs 새 값 비교
  --yolo              확인 없이 PATCH
  --model <id>        claude 모델 alias (default: sonnet)

${cyan("Layer 폴더:")}
  ${LAYER_DIRS.core}/*.md
  ${LAYER_DIRS.brand}/<name>.md
  ${LAYER_DIRS.section}/<name>.md

${cyan("캐시:")}
  ${CACHE_FILE}
`);
  process.exit(0);
}

function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}
const HAS = n => argv.includes(n);

const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    if (["--brand", "--section", "--fields", "--model"].includes(a)) i++;
    continue;
  }
  positional.push(a);
}

const cache = loadCache();
const CLI_BRAND = arg("--brand");
const CLI_SECTION = arg("--section");
const FIELDS_FILTER = arg("--fields")?.split(",").map(s => s.trim()).filter(Boolean) || null;
const DIFF = HAS("--diff");
const YOLO = HAS("--yolo");
const MODEL = arg("--model") || "sonnet";

// ── UI helpers
async function pickFromFolder(label, dir, current) {
  const opts = listOptions(dir);
  if (opts.length === 0) {
    console.log(yellow(`${label} 폴더 비어있음: ${dir}`));
    return current;
  }
  console.log(bold(`${label}:`));
  opts.forEach((o, i) => {
    const mark = o === current ? green("● ") : "  ";
    console.log(`  ${mark}${i + 1}. ${o}`);
  });
  if (label === "section") console.log(`  ${current === null ? green("● ") : "  "}0. (없음 — L3 skip)`);
  const ans = await ask(`> ${dim("번호 선택 또는 Enter=유지")}: `);
  if (ans === "") return current;
  if (ans === "0" && label === "section") return null;
  const idx = parseInt(ans, 10) - 1;
  if (idx >= 0 && idx < opts.length) return opts[idx];
  console.log(yellow(`잘못된 번호. 유지.`));
  return current;
}

async function interactive(state) {
  while (true) {
    console.log(bold(cyan(`\n━━━ copyGen — 호텔 카피 자동 생성 ━━━`)));
    console.log(dim(`brand:   ${state.brand}    section: ${state.section || "(없음)"}`));
    console.log();

    if (cache.recent.length > 0) {
      console.log(dim(`최근 URL:`));
      cache.recent.forEach((r, i) => {
        console.log(dim(`  ${i + 1}. ${r.name || ""}  ${gray(r.url)}`));
      });
      console.log();
    }
    const input = await ask(
      `URL paste 또는 ${cache.recent.length > 0 ? "[1-" + cache.recent.length + "] " : ""}${cyan("[b]")} brand  ${cyan("[s]")} section  ${cyan("[L]")} layer 편집  ${gray("[q]")} 종료\n> `
    );
    const c = input.toLowerCase();

    if (c === "q" || c === "") return null;
    if (c === "b") { state.brand = await pickFromFolder("brand", LAYER_DIRS.brand, state.brand); continue; }
    if (c === "s") { state.section = await pickFromFolder("section", LAYER_DIRS.section, state.section); continue; }
    if (c === "l") {
      const editor = process.env.EDITOR || "vim";
      const target = state.section ? join(LAYER_DIRS.section, `${state.section}.md`) : join(LAYER_DIRS.brand, `${state.brand}.md`);
      console.log(dim(`편집기 열기: ${target}`));
      spawnSync(editor, [target], { stdio: "inherit" });
      continue;
    }
    if (/^\d+$/.test(input)) {
      const idx = parseInt(input, 10) - 1;
      if (idx < 0 || idx >= cache.recent.length) { console.log(red(`✗ 잘못된 번호`)); continue; }
      return cache.recent[idx].url;
    }
    return input; // URL paste
  }
}

function printCopy(newCopy, currentFields, diff) {
  console.log();
  console.log(bold(cyan(`━━━ 생성된 카피 ━━━`)));
  for (const [k, v] of Object.entries(newCopy)) {
    console.log(`${bold(k)}:`);
    if (diff && currentFields[k]) {
      console.log(dim(`  (기존) ${JSON.stringify(currentFields[k])}`));
      console.log(green(`  (새 값) ${JSON.stringify(v)}`));
    } else {
      console.log(`  ${v}`);
    }
    console.log();
  }
}

async function runOnce(url, state) {
  const source = await createAirtableSource({
    mode: "live",   // 단일 record 작업 — 캐시 의미 작음
    baseId: undefined, // patch-record use case 가 url 에서 추출
    pat: process.env.AIRTABLE_PAT,
  }).catch(() => null);
  // 위 source 는 baseId 가 url 에서 추출되어야 하므로 use case 내부에서 source 재생성이 더 자연스러움
  // → patch-record 가 source 를 받아쓰기 때문에, 여기서 url 파싱 후 source 만들어 전달
  const { parseRecordUrl } = await import("./lib/copy/use-cases/patch-record.mjs");
  const { baseId } = parseRecordUrl(url);
  const liveSource = await createAirtableSource({
    mode: "live",
    baseId,
    pat: process.env.AIRTABLE_PAT,
  });

  return await generatePatchForRecord({
    url,
    brand: state.brand,
    section: state.section,
    fieldsFilter: FIELDS_FILTER,
    model: MODEL,
    commonLayersDir: LAYERS_DIR,
    source: liveSource,
  });
}

async function confirmMenu(state) {
  while (true) {
    const editHint = state.section
      ? `${yellow("[e2]")} L2 편집  ${yellow("[e3]")} L3 편집`
      : `${yellow("[e]")} L2 편집`;
    const ans = await ask(
      `\n${bold("PATCH?")}  ${green("[y]")} 박기  ${cyan("[r]")} 재생성  ${editHint} 후 재생성  ${gray("[n]")} 종료\n> `
    );
    const c = ans.toLowerCase();
    if (c === "y" || c === "yes") {
      try {
        const r = await applyPatch({
          baseId: state.baseId, tableId: state.tableId, recordId: state.recordId,
          newCopy: state.newCopy, pat: process.env.AIRTABLE_PAT,
        });
        console.log(green(`✓ Airtable 박힘`));
        console.log(`  → ${r.url}`);
      } catch (e) {
        console.error(red(`✗ ${e.message}`));
      }
      return;
    }
    if (c === "r") {
      console.log(dim(`\n재생성 중...`));
      const next = await runOnce(state.url, state);
      if (next && next.newCopy) {
        printCopy(next.newCopy, next.currentFields, state.diff);
        Object.assign(state, next);
      }
      continue;
    }
    if (c === "e" || c === "e2" || c === "e3") {
      const which = c === "e3" ? "section" : "brand";
      const name = which === "section" ? state.section : state.brand;
      if (which === "section" && !name) { console.log(yellow(`section 없음.`)); continue; }
      const path = which === "section" ? join(LAYER_DIRS.section, `${name}.md`) : join(LAYER_DIRS.brand, `${name}.md`);
      console.log(dim(`편집기 열기: ${path}`));
      spawnSync(process.env.EDITOR || "vim", [path], { stdio: "inherit" });
      console.log(dim(`재생성 중...`));
      const next = await runOnce(state.url, state);
      if (next && next.newCopy) {
        printCopy(next.newCopy, next.currentFields, state.diff);
        Object.assign(state, next);
      }
      continue;
    }
    if (c === "n" || c === "" || c === "q") {
      console.log(dim(`종료. (PATCH 안 함)`));
      return;
    }
    console.log(yellow(`알 수 없는 입력: '${ans}'`));
  }
}

// ── 메인
let url = positional[0];
const state = {
  brand: CLI_BRAND || cache.brand,
  section: CLI_SECTION !== null ? CLI_SECTION : cache.section,
};

if (!url) {
  url = await interactive(state);
  if (!url) { rl.close(); process.exit(0); }
}

const result = await runOnce(url, state).catch(e => { console.error(red(`✗ ${e.message}`)); process.exit(1); });

if (!result || !result.newCopy) {
  if (result?.reason) console.log(yellow(`⚠ ${result.reason}`));
  rl.close();
  process.exit(0);
}

pushRecent(cache, { url, name: result.rowName });
cache.brand = state.brand;
cache.section = state.section;
saveCache(cache);

printCopy(result.newCopy, result.currentFields, DIFF);

if (YOLO) {
  try {
    const r = await applyPatch({
      baseId: result.baseId, tableId: result.tableId, recordId: result.recordId,
      newCopy: result.newCopy, pat: process.env.AIRTABLE_PAT,
    });
    console.log(green(`✓ Airtable 박힘`));
    console.log(`  → ${r.url}`);
  } catch (e) {
    console.error(red(`✗ ${e.message}`));
  }
  rl.close();
  process.exit(0);
}

await confirmMenu({
  ...result,
  url,
  brand: state.brand,
  section: state.section,
  diff: DIFF,
});

rl.close();
