#!/usr/bin/env node
/**
 * lut — 이미지에 .cube LUT 을 결정론적으로 일괄 적용 (브랜드 톤 시스템화).
 *
 * 정신 (copy 도구 미러링):
 *   - 폴더 = 설정. 스크립트는 폴더가 시키는 대로만 한다 (SvelteKit 정신).
 *   - 시나리오 슬롯 하드코딩 없음 — 폴더명 = LUT명 = 진실 (folder = meaning).
 *   - LUT 적용엔 AI 없음. 100% 로컬 (ffmpeg) · 결정론.
 *
 * 단일 진입점 + verb (workerCtl 패턴):
 *   lut                      인터랙티브 (최근 프로젝트 → 액션)
 *   lut new <name> [parent]  새 프로젝트 골격 (parent 없으면 현재 폴더)
 *   lut watch <projectDir>   실시간 미리보기 (저장 시 _preview/ 자동 갱신)
 *   lut preview <projectDir> 미리보기 1회 처리 후 종료
 *   lut render <projectDir>  _out/ 최종 고해상도 출력
 *   lut status <projectDir>  폴더 스캔 결과만 출력 (처리 X)
 *   lut help
 *
 * 데이터 루트 하드코딩 0 — 프로젝트 폴더는 전부 인자로 받는다.
 */

import "./lib/freshness.mjs";

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { homedir } from "os";
import { spawnSync, execSync } from "child_process";
import { bold, dim, cyan, green, yellow, red } from "./lib/cli-color.mjs";
import { newProject } from "./lib/lut/project.mjs";
import { processProject } from "./lib/lut/run.mjs";
import { watchProject } from "./lib/lut/watch.mjs";
import { scanProject } from "./lib/lut/scan.mjs";
import { pickProject, chooseAction } from "./lib/lut/menu.mjs";
import { closeAsk, ask } from "./lib/cli-prompt.mjs";

// ── 최근 프로젝트 캐시 ───────────────────────────────────
const CACHE_DIR = join(homedir(), ".cache", "clavier");
const CACHE_FILE = join(CACHE_DIR, "lut.json");
function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { return { recent: [] }; }
}
function rememberProject(dir) {
  const c = loadCache();
  c.recent = [{ path: dir, at: new Date().toISOString() }, ...c.recent.filter(r => r.path !== dir)].slice(0, 10);
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

// ── 의존성 precheck — 없으면 자동 설치 (안내 X, 위험한 lib 아님) ──
function ensureDeps() {
  const missing = ["ffmpeg", "fswatch"].filter(b => spawnSync("which", [b], { stdio: "ignore" }).status !== 0);
  if (missing.length === 0) return;
  if (spawnSync("which", ["brew"], { stdio: "ignore" }).status !== 0) {
    console.error(red(`✗ ${missing.join(", ")} 없음 + Homebrew 없음 — 수동 설치 필요.`));
    process.exit(1);
  }
  console.log(yellow(`· ${missing.join(", ")} 자동 설치 (brew)...`));
  const r = spawnSync("brew", ["install", ...missing], { stdio: "inherit" });
  if (r.status !== 0) { console.error(red("✗ 설치 실패.")); process.exit(1); }
}

// ── 프로젝트 경로 검증 ───────────────────────────────────
function requireProject(p) {
  if (!p) { console.error(red("✗ 프로젝트 폴더 경로가 필요합니다.")); process.exit(1); }
  const dir = resolvePath(p);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(red(`✗ 폴더 없음: ${dir}`)); process.exit(1);
  }
  return dir;
}

function printStatus(dir) {
  const s = scanProject(dir);
  console.log(bold(cyan(`\n${dir}`)));
  console.log(`  ${dim("base   ")} ${s.baseLut ? green("_base.cube ✓") : dim("없음 (Scene 단독)")}`);
  console.log(`  ${dim("scenes ")} ${s.scenes.length ? s.scenes.map(x => `${cyan(x.name)}(${x.images.length})`).join(" ") : dim("없음")}`);
  if (s.emptyScenes.length) console.log(`  ${dim("빈폴더 ")} ${dim(s.emptyScenes.join(", "))}`);
  if (s.unmatched.length)   console.log(`  ${dim("skip   ")} ${yellow(s.unmatched.join(", "))} ${dim("(매칭 .cube 없음)")}`);
  if (s.orphanLuts.length)  console.log(`  ${dim("고아LUT")} ${dim(s.orphanLuts.map(n => n + ".cube").join(", "))}`);
}

const HELP = `lut — .cube LUT 일괄 적용 (folder = 설정 · AI 없음)

  lut                      인터랙티브 (최근 프로젝트 → 액션)
  lut new <name> [parent]  새 프로젝트 골격 (parent 없으면 현재 폴더)
  lut watch <dir>          실시간 미리보기 (저장 시 _preview/ 자동 갱신)
  lut preview <dir>        미리보기 1회 후 종료
  lut render <dir>         _out/ 최종 고해상도 출력
  lut status <dir>         스캔 결과만 출력
  lut help

  폴더: luts/<name>.cube → <name>/ 사진에 적용. luts/_base.cube 있으면 먼저 체인.
        밑줄(_) 시작 = 시스템 무시. 폴더명 = LUT명 = 진실.`;

async function main() {
  const [verb, ...rest] = process.argv.slice(2);

  if (verb === "help" || verb === "-h" || verb === "--help") { console.log(HELP); return; }

  // new 는 ffmpeg 불필요하지만, 다른 verb 전부 ffmpeg/fswatch 필요 → 공통 precheck
  if (verb !== "new" && verb !== "status") ensureDeps();

  if (verb === "new") {
    const name = rest[0];
    if (!name) { console.error(red("✗ 사용법: lut new <name> [parent]")); process.exit(1); }
    const { dir, created } = newProject(name, rest[1]);
    if (!created) { console.error(yellow(`이미 존재: ${dir}`)); process.exit(1); }
    rememberProject(dir);
    console.log(green(`\n✓ 생성: ${dir}`));
    console.log(dim(`  luts/ 에 .cube 떨구고, scene_a/b/c 를 네 시나리오명으로 rename 후:`));
    console.log(`    ${cyan(`lut watch "${dir}"`)}`);
    return;
  }

  if (verb === "status") { printStatus(requireProject(rest[0])); return; }

  if (verb === "watch")   { const d = requireProject(rest[0]); rememberProject(d); await watchProject(d); return; }
  if (verb === "preview") { const d = requireProject(rest[0]); rememberProject(d); await processProject(d, { mode: "preview" }); return; }
  if (verb === "render")  { const d = requireProject(rest[0]); rememberProject(d); await processProject(d, { mode: "final" }); return; }

  if (verb && verb !== undefined) { console.error(red(`✗ 알 수 없는 명령: ${verb}`)); console.log(HELP); process.exit(1); }

  // ── 인자 없음 → 인터랙티브 ──
  let target = await pickProject(loadCache().recent);
  if (target === null) { closeAsk(); return; }

  if (target === "NEW") {
    const name = await ask(`프로젝트명: `);
    if (!name) { closeAsk(); return; }
    const parent = await ask(`부모 경로 ${dim("(Enter=현재 폴더)")}: `);
    const { dir, created } = newProject(name, parent || undefined);
    if (!created) { console.log(yellow(`이미 존재: ${dir}`)); }
    else console.log(green(`✓ 생성: ${dir}`));
    rememberProject(dir);
    target = dir;
  }

  const dir = requireProject(target);
  rememberProject(dir);
  ensureDeps();
  const action = await chooseAction(dir);
  closeAsk();
  if (action === "exit") return;
  if (action === "watch")   await watchProject(dir);
  else if (action === "preview") await processProject(dir, { mode: "preview" });
  else if (action === "render")  await processProject(dir, { mode: "final" });
}

main().catch(e => { console.error(red(`✗ ${e.message}`)); process.exit(1); });
