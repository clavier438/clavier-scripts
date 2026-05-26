#!/usr/bin/env node
/**
 * copyMd — 폴더 기반 자유 지시 카피 (.md 출력)
 *
 * 사용:
 *   copyMd <folder> --instruction "지시 텍스트"
 *   copyMd <folder> -i "룸 4개 카피 만들어"
 *   echo "지시" | copyMd <folder>
 *
 * 폴더 컨벤션:
 *   <folder>/
 *   ├── inputs/*.md          ← 자산·brief·ia (자동 로드. 여기 안만 자료로 들어감.)
 *   ├── layers/              ← 옵션. 폴더 우선, 없으면 공통 fallback.
 *   └── output_v<NN>.md      ← 결과 (또는 --output 으로 명시)
 *
 *   ※ 폴더 직속 .md, templates/, 기타 위치는 자동 컨텍스트에 안 들어간다.
 *
 * Layer fallback:
 *   ~/dev/clavier/clavier-scripts/copy-layers/{1-core,2-brand,3-section}/
 *
 * 옵션:
 *   --instruction, -i <text>   생성 지시 (또는 stdin)
 *   --output, -o <file>        출력 경로 (default: <folder>/output_v<NN>.md)
 *   --model <id>               claude 모델 alias (default: haiku)
 *   --help, -h
 */

import "./lib/freshness.mjs";

import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { bold, dim, cyan, green, red } from "./lib/cli-color.mjs";
import { generateMd } from "./lib/copy/use-cases/generate-md.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const COMMON_LAYERS = join(REPO_ROOT, "copy-layers");
const CACHE_DIR = join(homedir(), ".cache", "clavier");
const CACHE_FILE = join(CACHE_DIR, "copyMd.json");

function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); }
  catch { return { recent: [] }; }
}
function saveCache(c) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

// ── CLI 파싱
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
  console.log(`${bold("copyMd")} — 폴더 기반 자유 지시 카피 (.md)

${cyan("사용:")}
  copyMd <folder> --instruction "지시"
  copyMd <folder> -i "룸 4개 카피 만들어"
  echo "지시" | copyMd <folder>

${cyan("폴더 컨벤션:")}
  <folder>/
  ├── inputs/*.md              ← 자산·brief·ia (자동 로드. 여기 안만 자료로 들어감.)
  ├── layers/                  ← 옵션. 폴더 우선, 없으면 공통 fallback.
  └── output_v<NN>.md          ← 결과 (또는 --output)

  ※ 폴더 직속 .md, templates/, 기타 위치는 자동 컨텍스트에 안 들어간다.

${cyan("Layer fallback:")}
  ${COMMON_LAYERS}/
  ├── 1-core/*.md
  ├── 2-brand/*.md
  └── 3-section/*.md

${cyan("옵션:")}
  --instruction, -i <text>   생성 지시 (또는 stdin)
  --output, -o <file>        출력 경로 (default: <folder>/output_v<NN>.md)
  --model <id>               claude 모델 alias (default: haiku)
  --help, -h
`);
  process.exit(0);
}

function arg(name, alias) {
  for (const n of [name, alias].filter(Boolean)) {
    const i = argv.indexOf(n);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  }
  return null;
}

const folder = argv.find(a => !a.startsWith("--") && !a.startsWith("-"));
const instructionArg = arg("--instruction", "-i");
const outputArg = arg("--output", "-o");
const MODEL = arg("--model") || "haiku";

if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(red(`✗ 폴더 없음 또는 디렉토리 아님: ${folder}`));
  process.exit(1);
}

// instruction — 인자 또는 stdin
let instruction = instructionArg;
if (!instruction && !process.stdin.isTTY) {
  instruction = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) instruction += chunk;
  instruction = instruction.trim();
}
if (!instruction) {
  console.error(red(`✗ 지시 없음. --instruction "..." 또는 stdin 으로 박아주세요.`));
  process.exit(1);
}

console.log(dim(`folder=${folder}  model=${MODEL}`));

try {
  const { mdPath, promptPath } = await generateMd({
    folder,
    instruction,
    model: MODEL,
    commonLayersDir: COMMON_LAYERS,
    outputArg,
  });
  console.log(green(`✓ saved`) + dim(`  ${mdPath}`));
  console.log(dim(`  prompt  ${promptPath}`));

  // 캐시
  const cache = loadCache();
  cache.recent = (cache.recent || []).filter(r => r.path !== folder);
  cache.recent.unshift({ path: folder, instruction, at: new Date().toISOString() });
  if (cache.recent.length > 10) cache.recent.length = 10;
  saveCache(cache);

  console.log();
  console.log(dim(`다음 — 결과 검수:`));
  console.log(`  open '${mdPath}'`);
  console.log(`  cursor '${mdPath}'`);
} catch (e) {
  console.error(red(`✗ ${e.message}`));
  process.exit(1);
}
