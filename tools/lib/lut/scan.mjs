// scan.mjs — 폴더 = 설정. 프로젝트 폴더 구조를 읽어 "무엇을 무엇에 적용할지" 도출.
//
// 정신 (copy/input-loader.mjs 와 동일): 스크립트는 폴더가 시키는 대로만 한다.
// 하드코딩한 시나리오 슬롯 없음 — 폴더명 = LUT명 = 진실 (folder = meaning).
//
// 컨벤션:
//   luts/<name>.cube   → 시나리오 <name> 용 Scene LUT
//   luts/_base.cube    → (특례) 있으면 모든 시나리오에 먼저 체인 적용. 없으면 Scene 단독.
//   luts/_<기타>.cube  → 무시 (밑줄 = 비활성 토글. 예: __base.cube, room_old → _room.cube)
//   <name>/            → 시나리오 폴더 (밑줄 시작 제외). 안의 이미지가 입력.
//   _preview/ _out/ _review/ → 밑줄 = 시스템 무시 (출력·수동영역)
//
// 시나리오 폴더명과 luts/<name>.cube 가 매칭돼야 처리. 매칭 안 되면 skip (경고용으로 분리 반환).

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"];

/** luts/ 는 LUT 라이브러리 — 시나리오 폴더 아님 (밑줄은 안 붙지만 예약). */
const RESERVED_DIRS = new Set(["luts"]);

/** 밑줄 접두사(_preview/_out/_review…) 또는 예약 디렉토리 = 시스템 무시. */
export const isIgnored = name => name.startsWith("_") || RESERVED_DIRS.has(name);

const isImage = name =>
  !isIgnored(name) && IMAGE_EXTS.includes(extLower(name));

function extLower(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => {
    try { return statSync(join(dir, n)).isDirectory(); } catch { return false; }
  });
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => {
    try { return statSync(join(dir, n)).isFile(); } catch { return false; }
  });
}

/**
 * 프로젝트 폴더를 스캔.
 * @param {string} projectDir
 * @returns {{
 *   projectDir: string,
 *   lutsDir: string,
 *   baseLut: string|null,            // _base.cube 절대경로 또는 null
 *   scenes: Array<{name, dir, lut, images: string[]}>,  // 매칭+이미지 있는 것
 *   emptyScenes: string[],           // lut 매칭됐으나 이미지 0
 *   unmatched: string[],             // 폴더는 있으나 luts/<name>.cube 없음
 *   orphanLuts: string[],            // luts/<name>.cube 있으나 폴더 없음
 * }}
 */
export function scanProject(projectDir) {
  const lutsDir = join(projectDir, "luts");

  // luts/ 안의 .cube 분류
  const cubeFiles = listFiles(lutsDir).filter(n => extLower(n) === ".cube");
  const baseLut = cubeFiles.includes("_base.cube") ? join(lutsDir, "_base.cube") : null;
  const sceneLutNames = new Set(
    cubeFiles
      .filter(n => !isIgnored(n))            // _base.cube·_기타 제외
      .map(n => n.slice(0, -".cube".length)) // stem
  );

  // 시나리오 폴더 (밑줄 제외)
  const sceneDirs = listDirs(projectDir).filter(n => !isIgnored(n));

  const scenes = [];
  const emptyScenes = [];
  const unmatched = [];
  const matchedLutNames = new Set();

  for (const name of sceneDirs.sort()) {
    if (!sceneLutNames.has(name)) { unmatched.push(name); continue; }
    matchedLutNames.add(name);
    const dir = join(projectDir, name);
    const images = listFiles(dir).filter(isImage).sort().map(n => join(dir, n));
    if (images.length === 0) { emptyScenes.push(name); continue; }
    scenes.push({ name, dir, lut: join(lutsDir, `${name}.cube`), images });
  }

  const orphanLuts = [...sceneLutNames].filter(n => !matchedLutNames.has(n)).sort();

  return { projectDir, lutsDir, baseLut, scenes, emptyScenes, unmatched, orphanLuts };
}

/** projectDir 안의 경로가 어느 시나리오에 속하는지 (watch 증분용). luts/_base → '*' (전체). */
export function sceneOfPath(projectDir, changedPath) {
  const lutsDir = join(projectDir, "luts");
  // luts/*.cube 변경
  if (changedPath.startsWith(lutsDir + "/")) {
    const fname = changedPath.slice(lutsDir.length + 1);
    if (fname === "_base.cube") return "*";              // base → 전체 재처리
    if (isIgnored(fname)) return null;                   // 비활성 lut
    if (extLower(fname) === ".cube") return fname.slice(0, -".cube".length);
    return null;
  }
  // <scene>/<img> 변경 — projectDir 직속 시나리오 폴더 안
  if (changedPath.startsWith(projectDir + "/")) {
    const rest = changedPath.slice(projectDir.length + 1);
    const top = rest.split("/")[0];
    if (isIgnored(top)) return null;                     // _preview/_out/_review 등
    if (rest.includes("/") && isImage(rest.split("/").pop())) return top;
    return null;
  }
  return null;
}
