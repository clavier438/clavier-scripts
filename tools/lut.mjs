#!/usr/bin/env node
// door: image    # ← scripts 브리핑 자기등록 (SSOT=이 줄). 섹션 바꾸려면 여기만.
/**
 * lut — 이미지에 .cube LUT 을 결정론적으로 일괄 적용 (브랜드 톤 시스템화).
 *
 * 정신 (copy 도구 미러링):
 *   - 폴더 = 설정. 폴더 계층 자체가 LUT 체인 (재귀). 슬롯 하드코딩 없음.
 *   - .cube 는 그 폴더(+하위) 사진에 적용. 이름 자유. 활성 1개. 밑줄 _ = 비활성/무시.
 *   - input/ 루트 cube = 베이스. LUT 적용엔 AI 없음 — 100% 로컬(ffmpeg)·결정론.
 *
 * 단일 진입점 + verb (workerCtl 패턴):
 *   lut                      인터랙티브 (최근 프로젝트 → 액션)
 *   lut new <name> [parent]  새 프로젝트 골격 + 샘플 (parent 없으면 현재 폴더)
 *   lut watch <projectDir>   실시간 — 저장 시 _preview/ 증분 갱신
 *   lut preview <projectDir> _preview/ 1회 처리 후 종료 (덮어쓰기)
 *   lut render <projectDir>  output/vNN/ 원본 해상도 최종 (버전 누적)
 *   lut status <projectDir>  input/ 스캔 — 각 폴더 적용 체인 출력
 *
 *   역추출 (적용의 거울 — 사진 → .cube, design-recon photo-lut/montage 재사용):
 *   lut reverse  <folder>            브랜드 사진 → 베이스 LUT + 원본 추정 + 몽타주 (폴더 안)
 *   lut transfer <출발> <모델>        출발→모델 룩 베이스 LUT (출발 폴더에) + 미리보기
 *   lut help
 *
 * 데이터 루트 하드코딩 0 — 프로젝트 폴더는 전부 인자로 받는다.
 */

import "./lib/freshness.mjs";

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, resolve as resolvePath } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { bold, dim, cyan, green, yellow, red } from "./lib/cli-color.mjs";
import { newProject } from "./lib/lut/project.mjs";
import { processProject } from "./lib/lut/run.mjs";
import { watchProject } from "./lib/lut/watch.mjs";
import { scanInput } from "./lib/lut/scan.mjs";
import { pickProject, chooseAction } from "./lib/lut/menu.mjs";
import { runReverse, runTransfer } from "./lib/lut/extract.mjs";
import { closeAsk, ask } from "./lib/cli-prompt.mjs";
import { basename } from "path";

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

// ── 프로젝트 경로 검증 (input/ 필수) ─────────────────────
function requireProject(p) {
  if (!p) { console.error(red("✗ 프로젝트 폴더 경로가 필요합니다.")); process.exit(1); }
  const dir = resolvePath(p);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(red(`✗ 폴더 없음: ${dir}`)); process.exit(1);
  }
  if (!existsSync(join(dir, "input"))) {
    console.error(red(`✗ input/ 폴더 없음: ${dir}`));
    console.error(dim(`  'lut new' 로 만들거나, 프로젝트 안에 input/ 을 두세요.`));
    process.exit(1);
  }
  return dir;
}

// ── 옵션 1개를 값과 함께 떼어내고 나머지 인자 반환 (reverse/transfer 의 --strength) ──
function takeOpt(rest, flag) {
  const i = rest.indexOf(flag);
  if (i < 0) return { val: undefined, rest };
  return { val: rest[i + 1], rest: rest.filter((_, j) => j !== i && j !== i + 1) };
}

function printStatus(dir) {
  const scan = scanInput(join(dir, "input"));
  console.log(bold(cyan(`\n${dir}`)));
  if (scan.units.length === 0) console.log(dim(`  (input/ 에 .cube + 사진 없음)`));
  for (const u of scan.units) {
    const chain = u.chain.map(c => basename(c)).join(" → ");
    console.log(`  ${cyan(u.rel)}  ${dim(u.images.length + "장")}  ${dim("→")} ${green(chain)}`);
  }
  for (const w of scan.warnings)
    console.log(`  ${yellow("⚠ " + w.rel)} ${dim("활성 cube 여러개: " + w.cubes.join(", ") + " (하위 스킵)")}`);
  if (scan.skippedNoLut.length)
    console.log(`  ${dim("· cube 없어 스킵: " + scan.skippedNoLut.join(", "))}`);
}

const HELP = `lut — .cube LUT 일괄 적용 (folder = 설정 · 재귀 체인 · AI 없음)

  lut                      인터랙티브 (최근 프로젝트 → 액션)
  lut new <name> [parent]  새 프로젝트 골격 + 샘플 (parent 없으면 현재 폴더)
  lut watch <dir>          실시간 — 저장 시 _preview/ 증분 갱신
  lut preview <dir>        _preview/ 1회 처리 (덮어쓰기)
  lut render <dir>         output/vNN/ 원본 해상도 최종 (버전 누적)
  lut status <dir>         각 폴더 적용 체인 출력

  역추출 (사진 → .cube · design-recon 재사용 · 몽타주 먼저):
  lut reverse  <폴더>          브랜드 사진 → 베이스 LUT + 원본 추정(_originals/) + 몽타주
  lut transfer <출발> <모델>    출발→모델 룩 베이스 LUT (출발 폴더에) + 미리보기(_preview/)
  lut help

  input/<폴더>/ 에 .cube + 사진. 폴더 계층 = LUT 체인 (바깥→안, 재귀).
  input/ 루트 cube = 베이스. 밑줄 _ = 비활성/무시. 폴더당 활성 cube 1개.
  reverse/transfer 는 input/ 골격 불필요 — 사진 폴더를 직접 가리킨다 ([--strength 0~1]).`;

async function main() {
  const [verb, ...rest] = process.argv.slice(2);

  if (verb === "help" || verb === "-h" || verb === "--help") { console.log(HELP); return; }
  if (verb !== "new" && verb !== "status") ensureDeps();

  if (verb === "new") {
    const name = rest[0];
    if (!name) { console.error(red("✗ 사용법: lut new <name> [parent]")); process.exit(1); }
    ensureDeps(); // 샘플 jpg 생성에 ffmpeg
    const { dir, created, sampleJpg } = newProject(name, rest[1]);
    if (!created) { console.error(yellow(`이미 존재: ${dir}`)); process.exit(1); }
    rememberProject(dir);
    console.log(green(`\n✓ 생성: ${dir}`));
    console.log(dim(`  input/sample/ 에 replaceThis.cube ${sampleJpg ? "+ sample.jpg" : "(jpg 생략 — ffmpeg 확인)"} 샘플.`));
    console.log(dim(`  sample/ 를 네 신 이름으로 rename, replaceThis.cube 를 진짜 LUT 으로 교체 후:`));
    console.log(`    ${cyan(`lut watch "${dir}"`)}`);
    return;
  }

  if (verb === "status") { printStatus(requireProject(rest[0])); return; }
  if (verb === "watch")   { const d = requireProject(rest[0]); rememberProject(d); await watchProject(d); return; }
  if (verb === "preview") { const d = requireProject(rest[0]); rememberProject(d); await processProject(d, { mode: "preview" }); return; }
  if (verb === "render")  { const d = requireProject(rest[0]); rememberProject(d); await processProject(d, { mode: "final" }); return; }

  // ── 역추출: input/ 골격 불필요 — 사진 폴더 직접 (apply 의 거울) ──
  if (verb === "reverse" || verb === "transfer") {
    const { val: sRaw, rest: pos } = takeOpt(rest, "--strength");
    const strength = sRaw != null ? Number(sRaw) : undefined;
    const folders = pos.filter(a => !a.startsWith("-"));
    if (verb === "reverse") {
      if (!folders[0]) { console.error(red("✗ 사용법: lut reverse <폴더> [--strength 0~1]")); process.exit(1); }
      await runReverse(resolvePath(folders[0]), { strength });
    } else {
      if (folders.length < 2) { console.error(red("✗ 사용법: lut transfer <출발폴더> <모델폴더> [--strength 0~1]")); process.exit(1); }
      await runTransfer(resolvePath(folders[0]), resolvePath(folders[1]), { strength });
    }
    return;
  }

  if (verb !== undefined) { console.error(red(`✗ 알 수 없는 명령: ${verb}`)); console.log(HELP); process.exit(1); }

  // ── 인자 없음 → 인터랙티브 ──
  let target = await pickProject(loadCache().recent);
  if (target === null) { closeAsk(); return; }

  if (target === "NEW") {
    const name = await ask(`프로젝트명: `);
    if (!name) { closeAsk(); return; }
    const parent = await ask(`부모 경로 ${dim("(Enter=현재 폴더)")}: `);
    ensureDeps();
    const { dir, created } = newProject(name, parent || undefined);
    console.log(created ? green(`✓ 생성: ${dir}`) : yellow(`이미 존재: ${dir}`));
    rememberProject(dir);
    target = dir;
  }

  const dir = requireProject(target);
  rememberProject(dir);
  ensureDeps();
  const action = await chooseAction(dir);
  closeAsk();
  if (action === "watch") await watchProject(dir);
  else if (action === "preview") await processProject(dir, { mode: "preview" });
  else if (action === "render") await processProject(dir, { mode: "final" });
}

main().catch(e => { console.error(red(`✗ ${e.message}`)); process.exit(1); });
