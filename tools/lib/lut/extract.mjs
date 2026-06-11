// extract.mjs — 사진 더미에서 .cube LUT 를 *역추출* (lut reverse / lut transfer 의 코어).
//
// lut(적용)의 거울: apply.mjs 는 .cube → 사진, extract 는 사진 → .cube.
//   reverse   <folder>            : 한 세트 → 브랜드 베이스 LUT + 역변환(원본 추정).
//   transfer  <start> <model>     : 두 세트 → 출발 룩을 모델 룩으로 옮기는 베이스 LUT.
//
// 정신(사용자 확정):
//   ① 몽타주 먼저 — 한 장씩 보지 말고 전체를 한 시트로 깔아 *한눈에* 판단 (photo-direction 1단계).
//   ② 그레이딩 과학은 design-recon 의 photo-lut(색만 보는 결정론)에 위임 — 여기선 오케스트레이션만.
//   ③ 적용(원본추정·미리보기)은 apply.mjs(ffmpeg)를 그대로 재사용 — Node 쪽 색수학 0 (drift 차단).

import { spawnSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, basename, relative, extname } from "path";
import { fileURLToPath } from "url";
import { applyOne, runPool } from "./apply.mjs";
import { bold, dim, cyan, green, yellow } from "../cli-color.mjs";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(TOOLS, "..");
const VENV_PY = join(REPO, "webExporter", ".venv", "bin", "python"); // PIL 있는 venv (img.py _py() 미러)
const py = () => (existsSync(VENV_PY) ? VENV_PY : "python3");

// 적용 대상 사진 확장자 (apply 소비자 로컬 상수 — 바퀴 아님). 생성 산출 폴더는 walk 에서 제외.
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif", ".bmp", ".gif"]);
const SKIP_DIRS = new Set(["_montage", "_originals", "_preview", "_cluster", "output", "input"]);

/** 폴더(재귀) 안 원본 사진 경로 — 숨김·생성 산출 폴더 제외. */
export function walkPhotos(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walkPhotos(p, out); }
    else if (PHOTO_EXTS.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

/** tools/<script> 위임 실행 — 진행 로그를 그대로 사용자에게(stdio inherit). 실패 시 throw. */
export function runPy(script, args, label) {
  const r = spawnSync(py(), [join(TOOLS, script), ...args], { stdio: "inherit" });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} 실패 (exit ${r.status})`);
}

export const requireDir = (p, label) => {
  const d = resolve(p);
  if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error(`${label} 폴더 없음: ${d}`);
  return d;
};

/** 역변환/미리보기 적용 — 각 사진에 단일 .cube 적용 → outRoot 에 구조 보존 .jpg. */
async function applyCube(photos, srcRoot, cube, outRoot, { scale }) {
  const thunks = photos.map(img => () => applyOne({
    input: img,
    output: join(outRoot, relative(srcRoot, img).replace(/\.[^.]+$/, "") + ".jpg"),
    chain: [cube], scale, quality: 2, preserveMetadata: false,
  }));
  const results = await runPool(thunks, {
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}   `),
  });
  process.stdout.write("\n");
  return results.filter(r => r.ok).length;
}

/**
 * reverse — 한 세트 → 브랜드 베이스 LUT + 원본 추정.
 * 산출(폴더 안): <name>.cube · <name>__inverse.cube · _originals/ · _montage/
 */
export async function runReverse(folder, { strength } = {}) {
  const dir = requireDir(folder, "대상");
  const photos = walkPhotos(dir);
  if (!photos.length) throw new Error(`사진 없음: ${dir}`);
  const name = basename(dir);

  console.log(bold(cyan(`\n① 몽타주 — 전체 ${photos.length}장 한눈에 (_montage/)`)));
  runPy("photo-montage.py", [dir, "--out", join(dir, "_montage")], "montage");

  console.log(bold(cyan(`\n② 브랜드 베이스 LUT 역추출 + 역변환 (photo-lut)`)));
  const args = [dir, "--single", "--inverse", "--outdir", dir, "--title", name];
  if (strength != null) args.push("--strength", String(strength));
  runPy("photo-lut.py", args, "photo-lut");
  const baseCube = join(dir, `${name}.cube`);
  const invCube = join(dir, `${name}__inverse.cube`);
  if (!existsSync(invCube)) throw new Error(`역변환 cube 생성 실패: ${invCube}`);

  console.log(bold(cyan(`\n③ 원본 추정 — 역변환 적용 → _originals/`)));
  const ok = await applyCube(photos, dir, invCube, join(dir, "_originals"), { scale: null });

  console.log(green(`\n✓ reverse 완료 — ${dir}`));
  console.log(`  ${cyan(name + ".cube")}          브랜드 베이스 LUT (다른 사진에 'lut' 으로 적용하면 같은 룩)`);
  console.log(`  ${cyan(name + "__inverse.cube")}  역변환 (그레이드 제거)`);
  console.log(`  ${cyan("_originals/")}  원본 추정 ${ok}/${photos.length}장`);
  console.log(`  ${cyan("_montage/")}    전체 몽타주 시트 (한눈에 판단)`);
  console.log(dim(`  · 원본 추정 = photo-lut 그레이딩 모델(톤커브+색캐스트)의 역 — 색/톤 캐스트를 걷어낸 추정이지`));
  console.log(dim(`    진짜 카메라 원본은 아님. 모델이 못 잡는 로컬 보정·디테일은 복원 안 됨.`));
}

/**
 * transfer — 출발·모델 두 세트 → 출발을 모델 룩으로 옮기는 베이스 LUT (출발 폴더에 생성).
 * 산출(출발 폴더 안): <start>__to__<model>.cube · _preview/ · _montage/{start,model}/
 */
export async function runTransfer(startFolder, modelFolder, { strength, preview = true } = {}) {
  const start = requireDir(startFolder, "출발");
  const model = requireDir(modelFolder, "모델");
  const startPhotos = walkPhotos(start);
  const modelPhotos = walkPhotos(model);
  if (!startPhotos.length) throw new Error(`출발 사진 없음: ${start}`);
  if (!modelPhotos.length) throw new Error(`모델 사진 없음: ${model}`);
  const title = `${basename(start)}__to__${basename(model)}`;

  console.log(bold(cyan(`\n① 몽타주 — 출발 ${startPhotos.length} · 모델 ${modelPhotos.length} (_montage/)`)));
  runPy("photo-montage.py", [start, "--out", join(start, "_montage", "start")], "montage(출발)");
  runPy("photo-montage.py", [model, "--out", join(start, "_montage", "model")], "montage(모델)");

  console.log(bold(cyan(`\n② 출발→모델 베이스 LUT 추출 (photo-lut transfer)`)));
  const outCube = join(start, `${title}.cube`);
  const args = [start, "--model", model, "-o", outCube, "--title", title];
  if (strength != null) args.push("--strength", String(strength));
  runPy("photo-lut.py", args, "photo-lut transfer");
  if (!existsSync(outCube)) throw new Error(`transfer cube 생성 실패: ${outCube}`);

  let ok = 0;
  if (preview) {
    console.log(bold(cyan(`\n③ 미리보기 — 출발에 적용 → _preview/ (룩이 모델로 가는지 눈으로)`)));
    ok = await applyCube(startPhotos, start, outCube, join(start, "_preview"), { scale: 1200 });
  }

  console.log(green(`\n✓ transfer 완료 — ${start}`));
  console.log(`  ${cyan(title + ".cube")}  출발→모델 베이스 LUT`);
  if (preview) console.log(`  ${cyan("_preview/")}  출발에 적용한 미리보기 ${ok}/${startPhotos.length}장`);
  console.log(`  ${cyan("_montage/")}  출발·모델 몽타주 (무엇을→무엇으로)`);
  console.log(dim(`  · 이 .cube 를 'lut' 프로젝트 input/ 에 넣으면 다른 사진에도 같은 변환 적용`));
  console.log(dim(`  · 모델 평균 색/톤에 맞춤(mean transfer) — 콘트라스트 분산·로컬 디테일까진 못 옮김`));
}
