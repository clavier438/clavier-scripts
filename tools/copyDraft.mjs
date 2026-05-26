#!/usr/bin/env node
/**
 * copyDraft — 폴더 기반 카피 초안 일괄 생성 (→ 다중 CSV)
 *
 * 두 모드:
 *   1. scratch  — Airtable 빈 base 를 inputs 로 채움 (default)
 *   2. model    — 이미 채워진 reference Airtable 을 모델로 삼아 생성
 *
 * 사용:
 *   copyDraft <folder> --base <URL>                                   # scratch
 *   copyDraft <folder> --base <URL> --model <URL>                     # model (default mode=ia)
 *   copyDraft <folder> --base <URL> --model <URL> --model-mode ia
 *   copyDraft <folder> --base <URL> --model <URL> --model-mode ia+content
 *
 * 폴더 컨벤션:
 *   <folder>/
 *   ├── inputs/*.md
 *   ├── layers/                  ← 옵션. 폴더 우선, 없으면 공통 fallback.
 *   └── <table>.csv              ← 출력 (airtableCtl 호환)
 *
 * Push (별도):
 *   airtableCtl 로 <folder>/*.csv 를 base 에 upsert.
 *
 * 옵션:
 *   --base <URL>               target Airtable 베이스 (첫 실행만, 이후 캐시)
 *   --model <URL>              모델로 삼을 reference Airtable (있으면 model 모드)
 *   --model-mode ia|ia+content "ia" = IA 구조만, "ia+content" = 표현까지 (default: ia)
 *   --source live|backup|auto  스키마/데이터 소스 (default: auto)
 *   --refresh-model            모델 스키마 hash 갱신 강제 (live 재fetch)
 *   --check-schema             live 로 스키마만 fetch → backup 의 hash 와 비교
 *   --model <id>               claude 모델 alias (default: sonnet)
 *   --sample-per-table <N>     ia+content 모드 시 테이블당 샘플 수 (default: 10)
 */

import "./lib/freshness.mjs";

import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { ensureDoppler } from "./lib/doppler-wrap.mjs";
import { extractBaseId } from "./lib/airtable-input.mjs";
import { bold, dim, cyan, green, yellow, red } from "./lib/cli-color.mjs";
import {
  createAirtableSource,
  checkSchemaChange,
  saveCachedHash,
} from "./lib/copy/adapters/airtable-source.mjs";
import { generateFromScratch } from "./lib/copy/use-cases/generate-from-scratch.mjs";
import { generateFromModel } from "./lib/copy/use-cases/generate-from-model.mjs";

ensureDoppler({
  project: "clavier",
  config: "prd",
  sentinelEnv: "_COPY_DRAFT_DOPPLER_INJECTED",
  requiredEnvs: ["AIRTABLE_PAT"],
});

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const COMMON_LAYERS = join(REPO_ROOT, "copy-layers");
const CACHE_DIR = join(homedir(), ".cache", "clavier");
const CACHE_FILE = join(CACHE_DIR, "copyDraft.json");

function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); }
  catch { return { recent: [], byFolder: {} }; }
}
function saveCache(c) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
  console.log(`${bold("copyDraft")} — 폴더 기반 카피 초안 일괄 생성 (CSV)

${cyan("두 모드:")}
  scratch  — 빈 Airtable 에 inputs 로 채움 (default)
  model    — 이미 채워진 reference Airtable 을 모델로 삼아 생성 (--model <URL>)

${cyan("사용:")}
  copyDraft <folder> --base <URL>                                # scratch
  copyDraft <folder> --base <URL> --model <URL>                  # model (default mode=ia)
  copyDraft <folder> --base <URL> --model <URL> --model-mode ia
  copyDraft <folder> --base <URL> --model <URL> --model-mode ia+content

${cyan("옵션:")}
  --base <URL>               target Airtable 베이스 (첫 실행만, 이후 캐시)
  --model <URL>              모델로 삼을 reference Airtable
  --model-mode ia|ia+content "ia" = IA 구조만, "ia+content" = 표현까지 (default: ia)
  --source live|backup|auto  스키마/데이터 소스 (default: auto)
  --refresh-model            모델 스키마 hash 갱신 강제
  --check-schema             스키마 hash 비교만 (live fetch → backup 과 비교)
  --claude-model <id>        claude 모델 alias (default: sonnet)
  --sample-per-table <N>     ia+content 모드의 테이블당 샘플 수 (default: 10)

${cyan("Push (별도):")}
  airtableCtl 로 <folder>/*.csv 를 base 에 upsert.

${cyan("Layer fallback:")}
  ${COMMON_LAYERS}/{1-core,2-brand,3-section}/
`);
  process.exit(0);
}

function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}
const HAS = n => argv.includes(n);

const folder = argv.find(a => !a.startsWith("--"));
const baseArg = arg("--base");
const modelArg = arg("--model");
const modelMode = arg("--model-mode") || "ia";
const SOURCE_MODE = arg("--source") || "auto";
const REFRESH_MODEL = HAS("--refresh-model");
const CHECK_SCHEMA = HAS("--check-schema");
const CLAUDE_MODEL = arg("--claude-model") || "sonnet";
const SAMPLE_PER_TABLE = parseInt(arg("--sample-per-table") || "10", 10);

if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(red(`✗ 폴더 없음 또는 디렉토리 아님: ${folder}`));
  process.exit(1);
}

const cache = loadCache();
const folderState = cache.byFolder[folder] || {};
const targetBaseId = baseArg ? extractBaseId(baseArg) : folderState.baseId;
if (!targetBaseId) {
  console.error(red(`✗ --base <URL> 필요 (첫 실행 시).`));
  process.exit(1);
}
const modelBaseId = modelArg ? extractBaseId(modelArg) : null;

console.log(dim(
  `folder=${folder}  target=${targetBaseId}` +
  (modelBaseId ? `  model=${modelBaseId} (mode=${modelMode})` : "") +
  `  source=${SOURCE_MODE}  claude=${CLAUDE_MODEL}`
));

// ── --check-schema: 짧게 hash 비교만
if (CHECK_SCHEMA) {
  if (!process.env.AIRTABLE_PAT) {
    console.error(red(`✗ --check-schema 는 PAT 필요`));
    process.exit(1);
  }
  try {
    const baseToCheck = modelBaseId || targetBaseId;
    const r = await checkSchemaChange({ baseId: baseToCheck, pat: process.env.AIRTABLE_PAT });
    console.log(dim(`base=${baseToCheck}`));
    console.log(`  cached: ${r.cached || "(없음)"}`);
    console.log(`  current: ${r.current}`);
    if (r.changed) {
      console.log(yellow(`⚠ 스키마 변경 감지. --refresh-model 권장.`));
    } else {
      console.log(green(`✓ 스키마 동일. 캐시 유효.`));
    }
  } catch (e) {
    console.error(red(`✗ ${e.message}`));
    process.exit(1);
  }
  process.exit(0);
}

try {
  // ── target source
  const targetSource = await createAirtableSource({
    mode: REFRESH_MODEL ? "live" : SOURCE_MODE,
    baseId: targetBaseId,
    pat: process.env.AIRTABLE_PAT,
  });
  console.log(green(`✓ target`) + dim(`  ${targetSource.mode}${targetSource.syncedAt ? ` (synced ${targetSource.syncedAt})` : ""}`));

  let result;

  if (modelBaseId) {
    // ── model 모드
    if (modelMode !== "ia" && modelMode !== "ia+content") {
      throw new Error(`--model-mode 는 "ia" 또는 "ia+content" — 받음: ${modelMode}`);
    }
    const modelSource = await createAirtableSource({
      mode: REFRESH_MODEL ? "live" : SOURCE_MODE,
      baseId: modelBaseId,
      pat: process.env.AIRTABLE_PAT,
    });
    console.log(green(`✓ model`) + dim(`  ${modelSource.mode}${modelSource.syncedAt ? ` (synced ${modelSource.syncedAt})` : ""} · mode=${modelMode}`));

    // 모델 스키마 hash 캐시 갱신
    const hash = await modelSource.schemaHash();
    saveCachedHash(modelBaseId, hash);

    result = await generateFromModel({
      folder,
      targetSource,
      modelSource,
      modelMode,
      model: CLAUDE_MODEL,
      commonLayersDir: COMMON_LAYERS,
      samplePerTable: SAMPLE_PER_TABLE,
    });
  } else {
    // ── scratch 모드
    result = await generateFromScratch({
      folder,
      source: targetSource,
      model: CLAUDE_MODEL,
      commonLayersDir: COMMON_LAYERS,
    });
  }

  console.log();
  for (const w of result.written) {
    console.log(green(`✓ ${w.tableName}.csv`) + dim(`  (${w.rows} rows)`));
  }

  // 캐시
  cache.byFolder[folder] = { baseId: targetBaseId, lastRun: new Date().toISOString() };
  cache.recent = (cache.recent || []).filter(r => r.path !== folder);
  cache.recent.unshift({ path: folder, at: new Date().toISOString() });
  if (cache.recent.length > 10) cache.recent.length = 10;
  saveCache(cache);

  console.log();
  console.log(green(`완료.`) + dim(`  ${result.version}  prompt: ${result.promptPath}`));
  console.log();
  console.log(dim(`다음 — airtableCtl 로 push:`));
  console.log(`  airtableCtl`);
} catch (e) {
  console.error(red(`✗ ${e.message}`));
  process.exit(1);
}
