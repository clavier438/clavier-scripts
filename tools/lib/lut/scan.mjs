// scan.mjs — 폴더 = 설정. input/ 트리를 재귀로 읽어 "각 사진에 어떤 LUT 체인" 도출.
//
// 정신 (folder = meaning): 폴더 계층 자체가 LUT 체인이다.
//   - 각 폴더의 활성 .cube(밑줄 안 붙은 것) 1개 = 그 폴더(+하위)에 적용.
//   - input/ 루트의 cube = 베이스 (아래 전부에 첫 체인).
//   - 한 사진의 적용 체인 = 루트→그 폴더까지 경로상 활성 cube 누적 (바깥→안).
//   - 하위 폴더로 내려가며 체인이 쌓임 (재귀). 예: base → 로비톤 → 흑백.
//
// 컨벤션 (cube·폴더 공통 한 가지 뜻): 밑줄(_) 접두사 = 비활성/무시.
//   _흑백.cube = 토글 보관, _wip/ = 시스템 무시. (_base 특례 없음.)

import { readdirSync, statSync } from "fs";
import { join } from "path";

export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".heic", ".heif"];

/** 밑줄 접두사 = 비활성/무시 (cube·폴더 공통). */
export const isIgnored = name => name.startsWith("_");

function extLower(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}
const isImageName = name => !isIgnored(name) && IMAGE_EXTS.includes(extLower(name));
const isCubeName = name => !isIgnored(name) && extLower(name) === ".cube";

function safeKind(p) {
  try { const s = statSync(p); return s.isDirectory() ? "dir" : s.isFile() ? "file" : "other"; }
  catch { return "other"; }
}

/**
 * input/ 트리를 재귀 스캔.
 * @param {string} inputDir
 * @returns {{
 *   units: Array<{rel:string, dir:string, images:string[], chain:string[]}>,
 *   warnings: Array<{rel:string, cubes:string[]}>,   // 폴더당 활성 cube ≥2 → 그 서브트리 스킵
 *   skippedNoLut: string[],                          // 사진 있으나 조상 통틀어 cube 0
 * }}
 */
export function scanInput(inputDir) {
  const units = [];
  const warnings = [];
  const skippedNoLut = [];

  function walk(dir, rel, chain) {
    let names;
    try { names = readdirSync(dir); } catch { return; }

    const cubes = names.filter(n => isCubeName(n) && safeKind(join(dir, n)) === "file").sort();
    if (cubes.length > 1) {
      warnings.push({ rel: rel || ".", cubes });
      return; // 모호 — 이 서브트리 스킵 (대안은 _ 토글)
    }
    const myChain = cubes.length === 1 ? [...chain, join(dir, cubes[0])] : chain;

    const images = names.filter(n => isImageName(n) && safeKind(join(dir, n)) === "file")
      .sort().map(n => join(dir, n));
    if (images.length) {
      if (myChain.length) units.push({ rel: rel || ".", dir, images, chain: myChain });
      else skippedNoLut.push(rel || ".");
    }

    const subs = names.filter(n => !isIgnored(n) && safeKind(join(dir, n)) === "dir").sort();
    for (const s of subs) walk(join(dir, s), rel ? `${rel}/${s}` : s, myChain);
  }

  walk(inputDir, "", []);
  return { units, warnings, skippedNoLut };
}

/** changedPath 가 속한 폴더의 input 기준 rel (watch 증분용). 파일 자체 X → 디렉토리 rel. */
export function folderRelOf(inputDir, changedPath) {
  if (!changedPath.startsWith(inputDir)) return null;
  let rest = changedPath.slice(inputDir.length).replace(/^\//, "");
  // 밑줄 폴더 경로면 무시
  if (rest.split("/").some(isIgnored)) return null;
  const slash = rest.lastIndexOf("/");
  return slash < 0 ? "." : rest.slice(0, slash);
}

export const isCubePath = p => isCubeName(p.split("/").pop());
export const isImagePath = p => isImageName(p.split("/").pop());
